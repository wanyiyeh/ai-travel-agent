import { openai } from "@/lib/openai";
import {
  ItinerarySchema,
  FlightInfoSchema,
  TripPreferencesSchema,
  type FlightInfo,
} from "@/lib/schemas";
import { validateItinerary } from "@/lib/validateItinerary";
import { iataToCity } from "@/lib/iataCity";
import { fetchCityRestaurants, fetchCityBreakfastPlaces, fetchCitySnackPlaces, buildRestaurantHintsPrompt, fetchCityAttractions, buildAttractionHintsPrompt, type BudgetLevel } from "@/lib/fetchCityRestaurants";
import { prisma, j } from "@/lib/db";
import { buildSystemPrompt, calcDays, repairTransitDayDepartureCities, tagWaypointCities } from "@/lib/itineraryGen";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

async function ensureDemoUser() {
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: "demo@ai-travel-agent.dev",
      name: "Demo User",
    },
  });
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      prompt,
      flightInfo: rawFlightInfo,
      preferences: rawPreferences,
    } = body;

    if (!rawFlightInfo) {
      return new Response("Missing flightInfo", { status: 400 });
    }

    const flightInfo: FlightInfo = FlightInfoSchema.parse(rawFlightInfo);
    const days = calcDays(flightInfo.departureDate, flightInfo.returnDate);

    const preferences = rawPreferences
      ? TripPreferencesSchema.parse(rawPreferences)
      : undefined;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const isMultiCity =
            iataToCity(flightInfo.returnDepartureCity) !== iataToCity(flightInfo.arrivalCity);
          const arrivalCityName = iataToCity(flightInfo.arrivalCity);
          const returnCityName = iataToCity(flightInfo.returnDepartureCity);

          const budget = preferences?.budget as BudgetLevel | undefined;
          const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
          let hintsPrompt = "";
          if (googleApiKey) {
            const iataCodes = [...new Set([flightInfo.arrivalCity, flightInfo.returnDepartureCity])];
            const cityEntries = await Promise.all(
              iataCodes.map(async (code) => {
                const [breakfastPlaces, mainMealPlaces, snackPlaces, attractions] = await Promise.all([
                  fetchCityBreakfastPlaces(code, googleApiKey),
                  fetchCityRestaurants(code, googleApiKey, budget),
                  fetchCitySnackPlaces(code, googleApiKey),
                  fetchCityAttractions(code, googleApiKey),
                ]);
                return { cityNameZh: iataToCity(code), iataCode: code, breakfastPlaces, mainMealPlaces, snackPlaces, attractions };
              })
            );
            hintsPrompt = buildAttractionHintsPrompt(cityEntries) + buildRestaurantHintsPrompt(cityEntries, budget);
          }

          const systemPrompt = buildSystemPrompt(flightInfo, preferences, days, hintsPrompt);

          const destinationDesc = isMultiCity
            ? `${flightInfo.arrivalCity} → ${flightInfo.returnDepartureCity}`
            : flightInfo.arrivalCity;
          const userContent = prompt?.trim()
            ? `請規劃行程，風格描述：${prompt}`
            : `請規劃 ${destinationDesc} ${days} 天行程`;

          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 16000,
            stream: true,
          });

          let accumulatedContent = "";

          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              accumulatedContent += content;
              const data = JSON.stringify({
                type: "chunk",
                content: accumulatedContent,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
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

            const repairedDays = isMultiCity
              ? repairTransitDayDepartureCities(taggedDays)
              : taggedDays;

            const validatedData = { ...validatedRaw, days: repairedDays };

            const logicResult = validateItinerary(
              validatedData,
              flightInfo,
              arrivalCityName,
              returnCityName,
            );

            if (!logicResult.valid) {
              const errors = logicResult.issues.filter((i) => i.severity === "error");
              console.warn("[Itinerary Validation] Logic errors:", errors);
              const errorData = JSON.stringify({
                type: "error",
                error: "行程邏輯驗證失敗",
                details: errors.map((e) => `[${e.code}] ${e.message}`).join("; "),
                validationIssues: logicResult.issues,
              });
              controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
              controller.close();
              return;
            }

            if (logicResult.issues.length > 0) {
              console.warn("[Itinerary Validation] Warnings:", logicResult.issues);
            }

            const dataWithIds = addIdsToItinerary(validatedData);

            let savedId: string | null = null;
            try {
              await ensureDemoUser();
              const saved = await prisma.itinerary.create({
                data: {
                  userId: DEMO_USER_ID,
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
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          } catch (error) {
            const errorData = JSON.stringify({
              type: "error",
              error: "資料格式驗證失敗",
              details: error instanceof Error ? error.message : String(error),
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          }

          controller.close();
        } catch (error) {
          const errorData = JSON.stringify({
            type: "error",
            error: "生成失敗",
            details: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Stream Error]", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
