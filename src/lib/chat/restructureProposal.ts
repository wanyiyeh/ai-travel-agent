import { bookedEventLabel, bookedEventOn } from "@/lib/fixedEvents";
import type { FixedEvent } from "@/lib/schemas";
import { MAX_TRIP_DAYS } from "@/lib/inputLimits";
import {
  MAX_TARGET_DAYS,
  computeCityDiff,
  computeStructuralDayIds,
  groupExistingDays,
  minCityDays,
  relinkCities,
  syncKeepDaysForTarget,
  type CityEntryState,
  type RestructureDayLite,
} from "@/lib/restructureCities";

// A chat restructure proposal (the route after the change: city, days, new
// or not) turned into restructure/route.ts's request, with the wizard's own
// rules (src/lib/restructureCities.ts, ADR-0014): every existing city stays,
// in its order; new cities can go anywhere; each city keeps at least its
// transit, return and booked days. Which existing days stay is the wizard's
// default choice, since the chat can't ask day by day.

export interface ProposedCity {
  name: string;
  days: number;
  isNew: boolean;
}

/** restructure/route.ts's request body. */
export interface RestructureRequest {
  cities: { name: string; isNew: boolean; targetDays: number; keepDayIds: string[]; lockedAttractions: [] }[];
}

/** What applying will do to each city, for the confirmation step. */
export interface CityPreview {
  name: string;
  isNew: boolean;
  daysBefore: number;
  daysAfter: number;
  /** Day numbers whose contents go to the trash. */
  removedDayNumbers: number[];
  /** Days planned afresh on apply. */
  newDays: number;
}

export type RestructurePlan =
  | { ok: true; request: RestructureRequest; preview: CityPreview[] }
  | { ok: false; problem: string };

type Rec = Record<string, unknown>;

function dayLites(days: unknown, config: unknown): RestructureDayLite[] {
  const events = ((config as { preferences?: { fixedEvents?: unknown } } | null)?.preferences?.fixedEvents ?? []) as FixedEvent[];
  return (Array.isArray(days) ? (days as Rec[]) : []).map((d, i) => {
    const booked = bookedEventOn(d, Array.isArray(events) ? events : []);
    return {
      id: String(d.id),
      day: typeof d.day === "number" ? d.day : i + 1,
      isTransitDay: d.isTransitDay === true,
      isLocked: d.isLocked === true,
      waypointCity: typeof d.waypointCity === "string" ? d.waypointCity : undefined,
      stopCount: Array.isArray(d.stops) ? d.stops.length : 0,
      ...(booked ? { bookedEventLabel: bookedEventLabel(booked), bookedEventDate: booked.date } : {}),
    };
  });
}

function newCity(name: string): CityEntryState {
  return {
    key: crypto.randomUUID(),
    name,
    isNew: true,
    existingDayIds: [],
    structuralDayIds: new Set(),
    bookedDayIds: new Set(),
    keepDayIds: new Set(),
    touchedKeep: false,
    targetDays: 1,
    lockedAttractions: [],
    fromRecommendation: false,
    hasOutboundTransit: false,
    leadingTransit: false,
    outboundReplaced: false,
  };
}

const fail = (problem: string): RestructurePlan => ({ ok: false, problem });

export function planRestructure(days: unknown, config: unknown, proposed: ProposedCity[]): RestructurePlan {
  const lites = dayLites(days, config);
  const existing = groupExistingDays(lites, computeStructuralDayIds(lites));
  if (existing.some((c) => !c.name)) return fail("這份行程沒有城市資訊，請改用「重新規劃行程」");
  if (proposed.length === 0) return fail("沒有收到修改後的城市");

  const byName = new Map(existing.map((c) => [c.name, c]));
  const proposedExisting = proposed.filter((p) => !p.isNew).map((p) => p.name);
  for (const name of proposedExisting) {
    if (!byName.has(name)) return fail(`行程裡沒有「${name}」`);
  }
  if (new Set(proposedExisting).size !== proposedExisting.length) return fail("同一個既有城市只能出現一次");
  if (proposedExisting.join("\n") !== existing.map((c) => c.name).join("\n")) {
    return fail("既有的城市要全部保留、順序也不能調換，只能加入新城市或調整天數");
  }
  const added = proposed.filter((p) => p.isNew);
  if (added.some((p) => !p.name.trim() || byName.has(p.name.trim()))) return fail("新城市的名稱不能空白，也不能跟既有城市重複");

  if (added.length === 0 && proposed.every((p) => p.days === byName.get(p.name)!.existingDayIds.length)) {
    return fail("跟現在的行程一樣，沒有需要修改的地方");
  }

  // The model counts an existing city's days as the trip shows them now. A
  // new city next to it moves a transit day (relinkCities: the city before
  // gives up its outbound day, the one after gains an arrival day), so the
  // model's number is applied as a change on top of the relinked count, as
  // the wizard's stepper does. A new city's count includes its arrival day.
  const linked = relinkCities(proposed.map((p) => (p.isNew ? newCity(p.name.trim()) : byName.get(p.name)!)));
  const planned: CityEntryState[] = [];
  for (const [i, city] of linked.entries()) {
    const wanted = proposed[i].days;
    const targetDays = city.isNew ? wanted : city.targetDays + (wanted - city.existingDayIds.length);
    if (targetDays < minCityDays(city)) return fail(`「${city.name}」的天數太少，至少要留下移動日和預訂的行程`);
    if (targetDays > MAX_TARGET_DAYS) return fail(`一個城市最多 ${MAX_TARGET_DAYS} 天`);
    planned.push(syncKeepDaysForTarget({ ...city, targetDays }));
  }
  const total = planned.reduce((sum, c) => sum + c.targetDays, 0);
  if (total > MAX_TRIP_DAYS) return fail(`整趟行程最多 ${MAX_TRIP_DAYS} 天`);

  const dayNumberOf = new Map(lites.map((d) => [d.id, d.day]));
  const preview = planned.map((city, i): CityPreview => {
    const diff = computeCityDiff(city);
    return {
      name: city.name,
      isNew: city.isNew,
      daysBefore: city.existingDayIds.length,
      daysAfter: proposed[i].days,
      removedDayNumbers: diff.removed.map((id) => dayNumberOf.get(id) ?? 0),
      newDays: city.isNew ? city.targetDays : diff.addedAiDays,
    };
  });

  return {
    ok: true,
    request: {
      cities: planned.map((c) => ({
        name: c.name,
        isNew: c.isNew,
        targetDays: c.targetDays,
        keepDayIds: c.existingDayIds.filter((id) => c.keepDayIds.has(id)),
        lockedAttractions: [],
      })),
    },
    preview,
  };
}
