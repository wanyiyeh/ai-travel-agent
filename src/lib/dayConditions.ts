import type { Climate } from "@/lib/climate";

// 日落和天氣排程 (plan/form-preference-wiring.md 1.12, phase 3c-4): what a
// day's schedule bends around, from last year's weather for the month
// (climate.ts) —
// - sunset: outdoor places before it (12月 東京 is dark by 16:30);
// - a hot month (30°C+ highs): outdoor places kept off midday, like 室內行程為主;
// - a rainy month (rain on over half the days): indoor places scored higher.

export type DayConditions = {
  /** Local sunset, minutes since midnight. */
  sunsetMinute: number;
  hot: boolean;
  rainy: boolean;
  /** Cold enough that the rain is often snow (11月 札幌, a 3.6°C high). */
  cold: boolean;
};

const HOT_C = 30;
const COLD_C = 5;
const RAINY_SHARE = 0.5;

/** Sunset on the trip date, between the month's first and last as the month goes on. */
export function sunsetOn(climate: Pick<Climate, "sunsetFirstMinute" | "sunsetLastMinute">, tripDate: string): number {
  const [year, month, day] = tripDate.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const along = daysInMonth > 1 ? (day - 1) / (daysInMonth - 1) : 0;
  return Math.round(climate.sunsetFirstMinute + (climate.sunsetLastMinute - climate.sunsetFirstMinute) * along);
}

export function conditionsOf(climate: Climate | undefined, tripDate: string): DayConditions | undefined {
  if (!climate) return undefined;
  return {
    sunsetMinute: sunsetOn(climate, tripDate),
    hot: climate.avgMaxTempC >= HOT_C,
    rainy: climate.rainyDayShare > RAINY_SHARE,
    cold: climate.avgMaxTempC < COLD_C,
  };
}

const clock = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

/** The line under a day's title: 「日落約 16:30・這個月常下雨，記得帶傘」. */
export function weatherNote(conditions: DayConditions | undefined): string | undefined {
  if (!conditions) return undefined;
  return [
    `日落約 ${clock(conditions.sunsetMinute)}`,
    ...(conditions.hot ? ["天氣炎熱，中午多排室內"] : []),
    ...(conditions.rainy ? [conditions.cold ? "這個月常下雨或下雪，記得帶傘" : "這個月常下雨，記得帶傘"] : []),
  ].join("・");
}
