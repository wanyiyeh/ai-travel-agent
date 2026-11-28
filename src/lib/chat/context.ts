import { keepsName } from "@/lib/placeStorage";
import { getCityHintForDay } from "@/lib/itineraryDays";
import { isTransitStop } from "@/lib/transitStop";
import { MEAL_LABELS } from "@/lib/mealRepeats";
import { MEAL_TYPES, type MealType } from "@/types/itinerary";

// What the chat model may know about a trip (ADR-0013): only our own data.
// Google's names, addresses, ratings, types and route times never reach it
// (ADR-0008); places are "day N, stop K", and the screen fills in the names.

type Rec = Record<string, unknown>;

const TIME_OF_DAY_LABELS: Record<string, string> = { morning: "上午", afternoon: "下午", evening: "晚上" };

// Names shorter than this match too much ordinary text to be worth replacing.
export const MIN_MATCHED_NAME_LENGTH = 2;

function asRecords(value: unknown): Rec[] {
  return Array.isArray(value) ? value.filter((v): v is Rec => Boolean(v) && typeof v === "object") : [];
}

// Days carry no date of their own: day N is departureDate + N - 1.
function dayDate(departureDate: string, index: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) return "";
  const date = new Date(`${departureDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function stopLine(stop: Rec, day: Rec, number: number): string {
  const parts = [`第${number}站`];
  const time = typeof stop.time_of_day === "string" ? TIME_OF_DAY_LABELS[stop.time_of_day] : undefined;
  if (time) parts.push(time);
  if (typeof stop.duration_minutes === "number") parts.push(`停留約 ${stop.duration_minutes} 分鐘`);
  const ownName = keepsName(stop) && typeof stop.name === "string" ? stop.name : "";
  if (isTransitStop(stop, day)) parts.push(`城市間交通${ownName ? `：${ownName}` : ""}`);
  else if (stop.fixedEvent) parts.push(`旅客預訂的固定行程${ownName ? `：${ownName}` : ""}`);
  return parts.join("，");
}

function mealsLine(day: Rec): string {
  const meals = (day.meals && typeof day.meals === "object" ? day.meals : {}) as Partial<Record<MealType, unknown>>;
  const skipped = new Set(Array.isArray(day.skippedMeals) ? day.skippedMeals : []);
  const planned = MEAL_TYPES.filter((type) => meals[type]).map((type) => MEAL_LABELS[type]);
  const removed = MEAL_TYPES.filter((type) => skipped.has(type)).map((type) => MEAL_LABELS[type]);
  return [
    planned.length ? `已排餐點：${planned.join("、")}` : "沒有排餐點",
    ...(removed.length ? [`旅客刪掉的餐點：${removed.join("、")}`] : []),
  ].join("；");
}

/** The trip as the model sees it: dates, cities, times and stays, no Google content. */
export function tripSummary(days: unknown, departureDate: string): string {
  return asRecords(days)
    .map((day, index) => {
      const flags = [
        dayDate(departureDate, index),
        getCityHintForDay(day),
        day.isTransitDay === true && typeof day.transitTo === "string" ? `移動日，前往${day.transitTo}` : "",
        day.isLocked === true ? "整天鎖定，不能修改" : "",
      ].filter(Boolean);
      const stops = asRecords(day.stops).map((stop, i) => `  ${stopLine(stop, day, i + 1)}`);
      const lodging = day.accommodation ? "有住宿" : "沒有住宿";
      const weather = typeof day.weatherNote === "string" ? [`  天氣：${day.weatherNote}`] : [];
      return [`第${index + 1}天（${flags.join("，")}）`, ...stops, `  ${mealsLine(day)}；${lodging}`, ...weather].join("\n");
    })
    .join("\n");
}

/** Every city on the route, in order, without repeats. */
export function tripCities(days: unknown): string[] {
  const cities = asRecords(days).flatMap((day) => [getCityHintForDay(day), typeof day.transitTo === "string" ? day.transitTo : ""]);
  return [...new Set(cities.filter(Boolean))];
}

// What a name the owner sees on screen points at. The client sends the names
// it already shows, so matching costs no Google call; the server checks each
// reference against the trip before trusting it.
export type NameRef =
  | { kind: "stop"; stopId: string }
  | { kind: "meal"; dayId: string; mealType: MealType }
  | { kind: "accommodation"; dayId: string };

export interface ShownName {
  ref: NameRef;
  name: string;
}

/** Where a reference sits in the trip, as the model would say it, or null when it isn't there. */
export function labelOf(days: unknown, ref: NameRef): string | null {
  const list = asRecords(days);
  if (ref.kind === "stop") {
    for (const [d, day] of list.entries()) {
      const s = asRecords(day.stops).findIndex((stop) => stop.id === ref.stopId);
      if (s >= 0) return `第${d + 1}天第${s + 1}站`;
    }
    return null;
  }
  const d = list.findIndex((day) => day.id === ref.dayId);
  if (d < 0) return null;
  if (ref.kind === "accommodation") return list[d].accommodation ? `第${d + 1}天的住宿` : null;
  const meals = (list[d].meals ?? {}) as Partial<Record<MealType, unknown>>;
  return meals[ref.mealType] ? `第${d + 1}天的${MEAL_LABELS[ref.mealType]}` : null;
}

const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

// The message folded for matching (full-width, case), with where each folded
// character came from, so a match can be cut out of the message as typed.
function foldWithOrigins(message: string): { folded: string; origins: number[] } {
  let folded = "";
  const origins: number[] = [];
  let offset = 0;
  for (const char of message) {
    const piece = normalize(char);
    folded += piece;
    for (let i = 0; i < piece.length; i++) origins.push(offset);
    offset += char.length;
  }
  origins.push(offset);
  return { folded, origins };
}

/**
 * Replaces the names the owner typed with where those places sit
 * (「淺草寺」→「第2天第3站」), so the model can act on them without seeing a
 * Google name. A name on several days becomes 「第2天第3站或第4天第1站」 and
 * the model asks which one. Longer names go first, so 「淺草寺」 wins over 「淺草」.
 */
export function replaceShownNames(message: string, days: unknown, shown: ShownName[]): string {
  const labelsByName = new Map<string, Set<string>>();
  for (const { ref, name } of shown) {
    const key = normalize(name).trim();
    const label = labelOf(days, ref);
    if (key.length < MIN_MATCHED_NAME_LENGTH || !label) continue;
    labelsByName.set(key, (labelsByName.get(key) ?? new Set()).add(label));
  }
  const { folded, origins } = foldWithOrigins(message);
  const taken: { start: number; end: number; label: string }[] = [];
  const names = [...labelsByName.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const label = [...labelsByName.get(name)!].join("或");
    for (let at = folded.indexOf(name); at >= 0; at = folded.indexOf(name, at + name.length)) {
      const start = origins[at];
      const end = origins[at + name.length];
      if (taken.some((t) => start < t.end && t.start < end)) continue;
      taken.push({ start, end, label });
    }
  }
  let text = message;
  for (const { start, end, label } of taken.sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, start)}「${label}」${text.slice(end)}`;
  }
  return text;
}
