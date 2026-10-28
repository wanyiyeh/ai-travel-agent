import { withDomesticTimes } from "@/lib/domesticTrips";
import { openai } from "@/lib/openai";
import {
  ItinerarySchema,
  GenerateRequestSchema,
  type FlightInfo,
} from "@/lib/schemas";
import { validateItinerary } from "@/lib/validateItinerary";
import { validateGeography } from "@/lib/validateGeography";
import { iataToCity } from "@/lib/iataCity";
import { lookupAirport } from "@/lib/airportIndex";
import { prisma, j } from "@/lib/db";
import {
  buildSystemPrompt,
  calcDays,
  repairMissingAccommodation,
  repairTransitDayDepartureCities,
  tagWaypointCities,
} from "@/lib/itineraryGen";
import { FixedEventCityError } from "@/lib/tripPlan";
import { assembleItineraryDays, type AssembledItinerary } from "@/lib/assembleItineraryDays";
import { clientIp } from "@/lib/rateLimit";
import { generateStreamGate } from "@/lib/sharedState";
import { newRequestId } from "@/lib/apiError";
import { UNTRUSTED_INPUT_RULE, wrapUntrusted } from "@/lib/untrustedInput";
import { runMetered } from "@/lib/usageMeter";
import { getActor } from "@/lib/auth/actor";
import { createGuestUser, guestCookieHeader, guestExpiry } from "@/lib/auth/guest";
import { checkQuota, quotaExceededResponse, recordUsage } from "@/lib/quota";
import { hashIp, requestFingerprint } from "@/lib/requestFingerprint";
import { captchaFailedResponse, verifyTurnstileToken } from "@/lib/turnstile";
import type { Day, Itinerary } from "@/types/itinerary";

// A handful of validation issues stem from the model misreading the prompt
// (wrong day count, missing transit day, etc.) rather than a structural gap
// we can repair in place — those are worth one full re-generation rather than
// failing the request outright. ACCOMMODATION_MISSING is deliberately absent:
// repairMissingAccommodation already patches it before validation runs.
const MAX_GENERATION_ATTEMPTS = 3;

// Vercel Hobby's longest function run; the streamed response counts too
// (#210). Past it the function is cut off mid-stream with nothing saved.
export const maxDuration = 300;

// No new work starts after this, measured from the request: what's left of
// maxDuration is for saving and closing the stream.
const GENERATION_DEADLINE_MS = 280_000;

// What an old-flow attempt needs before it's started. The longest one
// measured took 40s (a 10-day trip, docs/runbook.md); doubled for a slow
// OpenAI. The rule-engine path took up to 50s, so even after it fails there
// is room for a couple of attempts.
const OLD_FLOW_ATTEMPT_MS = 80_000;

// Told to the traveler when the deadline stops a generation; nothing is saved.
const TIMEOUT_EVENT = {
  type: "error",
  code: "timeout",
  error: "生成時間過長",
  details: "這次行程排太久還沒完成，請再試一次。",
};

function hasNonLastDayThinDay(
  issues: { code: string; day?: number }[],
  totalDays: number,
): boolean {
  // A short last day is expected (it's the return-flight day) — only a thin
  // day earlier in the trip is worth spending a retry attempt on.
  return issues.some((i) => i.code === "DAY_TOO_FEW_STOPS" && i.day !== totalDays);
}

function addIdsToItinerary(data: ReturnType<typeof ItinerarySchema.parse>) {
  return {
    ...data,
    days: data.days.map((day) => ({
      ...day,
      id: crypto.randomUUID(),
      stops: day.stops.map((stop, stopIdx) => ({
        ...stop,
        id: crypto.randomUUID(),
        orderIndex: stopIdx,
      })),
    })),
  };
}

// Same shape as addIdsToItinerary, but for the rule-engine path: its stops
// already carry a real id (a Google placeId, from Phase 3/4's
// assembleScheduledStops) that addIdsToItinerary would otherwise clobber with
// a fresh random one, throwing away real place data this path paid real API
// calls to resolve. Only backfills an id where one is genuinely missing (the
// LLM-fallback-generated transitStop, or a whole day that fell back
// to pure-LLM generation).
function addIdsPreservingExisting(data: AssembledItinerary) {
  return {
    ...data,
    days: data.days.map((day) => ({
      ...day,
      id: typeof day.id === "string" ? day.id : crypto.randomUUID(),
      stops: (day.stops as Array<Record<string, unknown>>).map((stop, stopIdx) => ({
        ...stop,
        id: typeof stop.id === "string" ? stop.id : crypto.randomUUID(),
        orderIndex: stopIdx,
      })),
    })),
  };
}

export async function POST(request: Request) {
  // Integration tests shorten the deadline to reach the timeout path.
  const deadline = Date.now() + (Number(process.env.GENERATION_DEADLINE_MS_FOR_TESTS) || GENERATION_DEADLINE_MS);
  const timeLeft = () => deadline - Date.now();
  try {
    const body = await request.json().catch(() => null);
    // Rejects before any OpenAI/Google call: an over-long trip or prompt is
    // the cheapest way to multiply one request's cost.
    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }

    const { prompt, preferences } = parsed.data;
    // Three letters isn't enough: a code no airport has would plan around a
    // city named "XYZ". Any hand-kept or generated airport goes (PLAN-003).
    const { departureCity, arrivalCity, returnDepartureCity, returnArrivalCity } = parsed.data.flightInfo;
    const unknown = [departureCity, arrivalCity, returnDepartureCity, returnArrivalCity].filter(
      (code): code is string => Boolean(code) && !lookupAirport(code!)
    );
    if (unknown.length > 0) {
      return Response.json({ error: `找不到這個機場代號：${unknown.join("、")}` }, { status: 400 });
    }
    // 國內: arriving and leaving worked out from the times at home (domesticTrips.ts).
    const flightInfo: FlightInfo = withDomesticTimes(parsed.data.flightInfo, preferences?.transport === "drive");
    const days = calcDays(flightInfo.departureDate, flightInfo.returnDate);

    // One generation at a time per client; released when the stream ends,
    // whichever way it ends. Keyed by the IP's hash, never the raw IP (#279);
    // the raw IP only goes to Turnstile.
    const ip = clientIp(request.headers);
    const gateKey = hashIp(ip);
    const lease = await generateStreamGate.tryAcquire(gateKey);
    if (!lease) {
      return Response.json(
        { error: "A generation is already in progress" },
        { status: 429, headers: { "Retry-After": "30" } },
      );
    }

    // Itineraries are owned by whoever generates them, and only the owner can
    // open them afterwards. A signed-out visitor becomes a guest here (after
    // the gate, so a refused request doesn't leave a stray guest row); guest
    // itineraries expire unless claimed by signing in
    // (plan/access-control.md §5, §7).
    let ownerId: string;
    let expiresAt: Date | null = null;
    let setGuestCookie: string | null = null;
    try {
      const actor = await getActor();

      // Bot check before anything else that costs or writes; admins skip it.
      if (!actor?.isAdmin) {
        const captcha = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
        if (!captcha.ok) {
          console.warn(`[generate-stream] Turnstile rejected: ${captcha.reason}`);
          await generateStreamGate.release(gateKey, lease);
          return captchaFailedResponse();
        }
      }

      // Daily quotas (plan/access-control.md §2–§4), checked before a guest
      // row is created or anything is billed.
      const fingerprint = requestFingerprint(request);
      const decision = await checkQuota(actor, "generate", fingerprint);
      if (!decision.ok) {
        await generateStreamGate.release(gateKey, lease);
        return quotaExceededResponse(decision);
      }

      if (actor) {
        ownerId = actor.userId;
        if (actor.kind === "guest") expiresAt = guestExpiry();
      } else {
        const guest = await createGuestUser();
        ownerId = guest.id;
        expiresAt = guestExpiry();
        setGuestCookie = guestCookieHeader(guest.id);
      }

      // Recorded up front: the OpenAI/Google calls cost the same whether or
      // not the generation ends up succeeding. Admins aren't counted, so
      // they don't use up the site-wide caps.
      if (!actor?.isAdmin) {
        await recordUsage("generate", { userId: ownerId, isGuest: actor?.kind !== "user" }, fingerprint);
      }
    } catch (error) {
      await generateStreamGate.release(gateKey, lease);
      throw error;
    }

    const encoder = new TextEncoder();
    // Set when the browser goes away mid-generation (tab closed, page
    // reloaded). Writing to the stream after that throws, which used to be
    // mistaken for a rule-engine failure and set off the paid old-flow
    // fallback for nobody. Now sends become no-ops, the rule-engine result is
    // still saved (it shows up in the itinerary list), and no fallback runs.
    let clientGone = false;
    const stream = new ReadableStream({
      cancel: () => {
        clientGone = true;
      },
      // Metered so each generation logs its Google/OpenAI call counts
      // ("[usage] generate-stream ...") — plan/access-control.md §3.
      start: (controller) => runMetered("generate-stream", async () => {
        const send = (data: string) => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            clientGone = true;
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        };
        try {
          const isMultiCity =
            iataToCity(flightInfo.returnDepartureCity) !== iataToCity(flightInfo.arrivalCity);
          const arrivalCityName = iataToCity(flightInfo.arrivalCity);
          const returnCityName = iataToCity(flightInfo.returnDepartureCity);

          // Try the rule-engine path first (plan/hybrid-rule-engine-scheduling.md
          // Phase 5(c)): planTrip() + per-city generation instead of one giant
          // free-form completion. Emits "plan"/"day" events as pieces become
          // available so the client can render progressively rather than
          // waiting for one accumulating JSON blob. Any failure here — null
          // from planTrip, a thrown error, or a hard validation error — falls
          // straight through to the untouched old flow below; nothing about
          // that flow is changed by this block.
          let newPathEmittedEvents = false;
          try {
            const assembled = await assembleItineraryDays(
              flightInfo,
              prompt,
              preferences,
              process.env.OPENAI_MODEL ?? "gpt-4o-mini",
              (event) => {
                newPathEmittedEvents = true;
                send(JSON.stringify(event));
              }
            );

            if (assembled) {
              // A round trip can loop out and back (tripPlan.ts), so it may
              // have transit days too, not just an open-jaw trip.
              const hasTransitDays = assembled.days.some((d) => d.isTransitDay === true);
              const cityRepairedDays = isMultiCity || hasTransitDays
                ? repairTransitDayDepartureCities(assembled.days as unknown as Day[])
                : (assembled.days as unknown as Day[]);
              const repairedDays = repairMissingAccommodation(cityRepairedDays);
              const finalItinerary: AssembledItinerary = { ...assembled, days: repairedDays };

              const logicResult = validateItinerary(
                finalItinerary as unknown as Itinerary,
                flightInfo,
                iataToCity(flightInfo.arrivalCity),
                iataToCity(flightInfo.returnDepartureCity)
              );
              logicResult.issues.push(...validateGeography(finalItinerary as unknown as Itinerary));

              if (logicResult.valid) {
                const dataWithIds = addIdsPreservingExisting(finalItinerary);

                let savedId: string | null = null;
                try {
                  const saved = await prisma.itinerary.create({
                    data: {
                      userId: ownerId,
                      expiresAt,
                      title: dataWithIds.title,
                      days: j(dataWithIds.days),
                      config: j({
                        generatedWith: prompt ?? "",
                        totalDays: days,
                        createdAt: new Date().toISOString(),
                        isStreamed: true,
                        flightInfo,
                        preferences: preferences ?? null,
                        currency: dataWithIds.currency ?? null,
                      }),
                    },
                  });
                  savedId = saved.id;
                  console.log(`[Stream] Itinerary saved (rule-engine path): ${savedId}`);
                } catch (dbError) {
                  console.error("[DB Save Error]", dbError);
                }

                const finalData = JSON.stringify({
                  type: "complete",
                  data: dataWithIds,
                  id: savedId,
                  warnings: logicResult.issues.filter((i) => i.severity === "warning"),
                });
                send(finalData);
                close();
                return;
              }
              console.warn("[Stream] Rule-engine path failed validation, falling back to LLM flow:", logicResult.issues);
            }
          } catch (err) {
            // A booked event's city that can't fit the route: the old flow
            // would ignore the requirement, so say what to change instead.
            if (err instanceof FixedEventCityError) {
              send(JSON.stringify({ type: "error", error: "固定行程排不進路線", details: err.message }));
              close();
              return;
            }
            console.warn("[Stream] Rule-engine path threw, falling back to LLM flow:", err);
          }

          if (clientGone) {
            console.warn("[Stream] client disconnected; skipping the old-flow fallback");
            close();
            return;
          }
          if (timeLeft() < OLD_FLOW_ATTEMPT_MS) {
            console.warn(`[Stream] ${Math.round(timeLeft() / 1000)}s left; no time for the old-flow fallback`);
            send(JSON.stringify(TIMEOUT_EVENT));
            close();
            return;
          }

          if (newPathEmittedEvents) {
            // The rule-engine path got far enough to show the client a partial
            // preview (plan/day events) before failing — reuse the existing
            // "retry" event so it clears that state instead of mixing it with
            // the old flow's own chunk-based streaming below.
            const retryData = JSON.stringify({ type: "retry", attempt: 1, maxAttempts: MAX_GENERATION_ATTEMPTS });
            send(retryData);
          }

          // No Google hint lists: the old flow's model picks places of its
          // own, which enrich-all-stops then looks up (ADR-0008).
          const systemPrompt = buildSystemPrompt(flightInfo, preferences, days);

          const destinationDesc = isMultiCity
            ? `${flightInfo.arrivalCity} → ${flightInfo.returnDepartureCity}`
            : flightInfo.arrivalCity;
          const userContent = prompt?.trim()
            ? `請規劃 ${destinationDesc} ${days} 天行程，旅客的風格描述：\n${wrapUntrusted(prompt)}`
            : `請規劃 ${destinationDesc} ${days} 天行程`;

          let lastErrorEvent: Record<string, unknown> | null = null;

          for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
            // Don't pay for another attempt nobody will receive.
            if (clientGone) {
              console.warn(`[Stream] client disconnected; stopping before attempt ${attempt}`);
              close();
              return;
            }
            if (timeLeft() < OLD_FLOW_ATTEMPT_MS) {
              console.warn(`[Stream] ${Math.round(timeLeft() / 1000)}s left; stopping before attempt ${attempt}`);
              send(JSON.stringify(TIMEOUT_EVENT));
              close();
              return;
            }
            if (attempt > 1) {
              const retryData = JSON.stringify({
                type: "retry",
                attempt,
                maxAttempts: MAX_GENERATION_ATTEMPTS,
              });
              send(retryData);
            }

            // Cut off at the deadline rather than by Vercel, so the traveler
            // gets a clear error instead of a dropped connection.
            const attemptSignal = AbortSignal.timeout(Math.max(1, timeLeft()));
            let accumulatedContent = "";
            try {
              const completion = await openai.chat.completions.create(
                {
                  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
                  messages: [
                    { role: "system", content: systemPrompt + UNTRUSTED_INPUT_RULE },
                    { role: "user", content: userContent },
                  ],
                  response_format: { type: "json_object" },
                  temperature: 0.7,
                  max_tokens: 16000,
                  stream: true,
                },
                { signal: attemptSignal },
              );

              for await (const chunk of completion) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                  accumulatedContent += content;
                  const data = JSON.stringify({
                    type: "chunk",
                    content: accumulatedContent,
                  });
                  send(data);
                }
              }
            } catch (error) {
              if (!attemptSignal.aborted) throw error;
              console.warn(`[Stream] deadline reached during attempt ${attempt}; nothing saved`);
              send(JSON.stringify(TIMEOUT_EVENT));
              close();
              return;
            }

            try {
              const parsedData = JSON.parse(accumulatedContent);
              const validatedRaw = ItinerarySchema.parse(parsedData);

              // The last day is always the return flight day — strip any AI hallucination of isTransitDay
              const lastIdx = validatedRaw.days.length - 1;
              const strippedDays =
                validatedRaw.days[lastIdx]?.isTransitDay
                  ? validatedRaw.days.map((d, i) =>
                      i === lastIdx ? { ...d, isTransitDay: false, transitTo: undefined } : d
                    )
                  : validatedRaw.days;

              // Tag every day with its resolved city before repairing/validating, so both
              // steps reason about the real (possibly multi-segment) city sequence instead
              // of assuming exactly one arrival→return transition.
              const taggedDays = tagWaypointCities(strippedDays, arrivalCityName);

              const cityRepairedDays = isMultiCity
                ? repairTransitDayDepartureCities(taggedDays)
                : taggedDays;
              const repairedDays = repairMissingAccommodation(cityRepairedDays);

              const validatedData = { ...validatedRaw, days: repairedDays };

              const logicResult = validateItinerary(
                validatedData,
                flightInfo,
                arrivalCityName,
                returnCityName,
              );
              logicResult.issues.push(...validateGeography(validatedData));

              const thinDayPresent = hasNonLastDayThinDay(logicResult.issues, validatedData.days.length);

              if (!logicResult.valid) {
                const errors = logicResult.issues.filter((i) => i.severity === "error");
                console.warn(`[Itinerary Validation] Attempt ${attempt} logic errors:`, errors);
                lastErrorEvent = {
                  type: "error",
                  error: "行程邏輯驗證失敗",
                  details: errors.map((e) => `[${e.code}] ${e.message}`).join("; "),
                  validationIssues: logicResult.issues,
                };
                if (attempt < MAX_GENERATION_ATTEMPTS) continue;
                break;
              }

              // Valid, but a non-last day came back thin — worth spending a
              // remaining attempt on, though never worth failing the request
              // over once attempts run out (it's only a warning).
              if (thinDayPresent && attempt < MAX_GENERATION_ATTEMPTS) {
                console.warn(`[Itinerary Validation] Attempt ${attempt}: thin day present, retrying for quality`);
                lastErrorEvent = {
                  type: "error",
                  error: "行程品質未達標準",
                  details: logicResult.issues.map((e) => `[${e.code}] ${e.message}`).join("; "),
                  validationIssues: logicResult.issues,
                };
                continue;
              }

              if (logicResult.issues.length > 0) {
                console.warn("[Itinerary Validation] Warnings:", logicResult.issues);
              }

              const dataWithIds = addIdsToItinerary(validatedData);

              let savedId: string | null = null;
              try {
                const saved = await prisma.itinerary.create({
                  data: {
                    userId: ownerId,
                    expiresAt,
                    title: validatedData.title,
                    days: j(dataWithIds.days),
                    config: j({
                      generatedWith: prompt ?? "",
                      totalDays: days,
                      createdAt: new Date().toISOString(),
                      isStreamed: true,
                      flightInfo,
                      preferences: preferences ?? null,
                      currency: validatedData.currency ?? null,
                    }),
                  },
                });
                savedId = saved.id;
                console.log(`[Stream] Itinerary saved: ${savedId}`);
              } catch (dbError) {
                console.error("[DB Save Error]", dbError);
              }

              const finalData = JSON.stringify({
                type: "complete",
                data: validatedData,
                id: savedId,
                warnings: logicResult.issues.filter((i) => i.severity === "warning"),
              });
              send(finalData);
              close();
              return;
            } catch (error) {
              // The raw parse/zod/DB error stays in the server log, keyed by
              // requestId; the client only gets the id to quote.
              const requestId = newRequestId();
              console.warn(`[Itinerary Validation] requestId=${requestId} attempt ${attempt} parse/schema error:`, error);
              lastErrorEvent = {
                type: "error",
                error: "資料格式驗證失敗",
                requestId,
              };
              if (attempt < MAX_GENERATION_ATTEMPTS) continue;
            }
          }

          send(JSON.stringify(lastErrorEvent));
          close();
        } catch (error) {
          const requestId = newRequestId();
          console.error(`[Generate Stream] requestId=${requestId}`, error);
          const errorData = JSON.stringify({
            type: "error",
            error: "生成失敗",
            requestId,
          });
          send(errorData);
          close();
        } finally {
          await generateStreamGate.release(gateKey, lease);
        }
      }),
    });

    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    if (setGuestCookie) headers.append("Set-Cookie", setGuestCookie);
    return new Response(stream, { headers });
  } catch (error) {
    console.error("[Stream Error]", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
