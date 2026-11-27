import { MEAL_LABELS } from "@/lib/mealRepeats";
import { MEAL_TYPES, type Day, type MealType } from "@/types/itinerary";
import type { ShownName } from "@/lib/chat/context";

// How the chat panel words what the assistant points at. The model only says
// 「第N天第K站」 (ADR-0013); the names come from what the page already shows
// (withPlaceNames), so nothing here fetches anything.

export interface StopRef {
  dayId: string;
  stopId: string;
}

/** A proposal as the panel gets it: an action and our own references. */
export interface ProposalLike {
  action: string;
  params: unknown;
}

function dayIndexOf(days: Day[], dayId: string): number {
  return days.findIndex((d) => d.id === dayId);
}

function locate(days: Day[], ref: StopRef): { dayNumber: number; stopNumber: number; name?: string } | null {
  const d = dayIndexOf(days, ref.dayId);
  if (d < 0) return null;
  const s = days[d].stops.findIndex((stop) => stop.id === ref.stopId);
  if (s < 0) return null;
  return { dayNumber: d + 1, stopNumber: s + 1, name: days[d].stops[s].name || undefined };
}

/** 「第2天第3站「淺草寺」」, or without the name when the page hasn't loaded it. */
export function stopLabel(days: Day[], ref: StopRef): string {
  const at = locate(days, ref);
  if (!at) return "已經不在行程裡的景點";
  return `第${at.dayNumber}天第${at.stopNumber}站${at.name ? `「${at.name}」` : ""}`;
}

/** Adds the place's name after each 「第N天第K站」 the reply mentions. */
export function withStopNames(text: string, days: Day[]): string {
  return text.replace(/第(\d+)天第(\d+)站/g, (whole, d: string, s: string) => {
    const name = days[Number(d) - 1]?.stops[Number(s) - 1]?.name;
    return name ? `${whole}（${name}）` : whole;
  });
}

/** The names on the owner's screen, sent with each message so a typed name can be matched (#369). */
export function shownNamesOf(days: Day[]): ShownName[] {
  const names: ShownName[] = [];
  for (const day of days) {
    if (!day.id) continue;
    for (const stop of day.stops) {
      if (stop.id && stop.name) names.push({ ref: { kind: "stop", stopId: stop.id }, name: stop.name });
    }
    for (const mealType of MEAL_TYPES) {
      const meal = day.meals?.[mealType];
      if (meal?.name) names.push({ ref: { kind: "meal", dayId: day.id, mealType }, name: meal.name });
    }
    if (day.accommodation?.name) names.push({ ref: { kind: "accommodation", dayId: day.id }, name: day.accommodation.name });
  }
  return names;
}

function mealLabel(days: Day[], dayId: string, mealType: MealType): string {
  const d = dayIndexOf(days, dayId);
  const name = days[d]?.meals?.[mealType]?.name;
  return `第${d + 1}天的${MEAL_LABELS[mealType]}${name ? `「${name}」` : ""}`;
}

function dayLabel(days: Day[], dayId: string): string {
  return `第${dayIndexOf(days, dayId) + 1}天`;
}

type Params = Record<string, unknown> & { dayId: string; stopId: string; mealType: MealType; request: string | null };

/** One line saying what confirming the card will do. */
export function describeProposal(proposal: ProposalLike, days: Day[]): string {
  const p = (proposal.params ?? {}) as Params;
  const wanted = p.request ? `，找「${p.request}」` : "";
  switch (proposal.action) {
    case "remove_stop":
      return `刪除${stopLabel(days, p)}`;
    case "move_stop":
      return `把${stopLabel(days, p)}移到第 ${Number(p.toIndex) + 1} 站`;
    case "replace_stop":
      return `換掉${stopLabel(days, p)}（從候選清單挑）`;
    case "suggest_stops":
      return `為${dayLabel(days, p.dayId)}加景點（從建議清單挑）`;
    case "replace_meal":
      return `換掉${mealLabel(days, p.dayId, p.mealType)}${wanted}（從候選清單挑）`;
    case "remove_meal":
      return `刪除${mealLabel(days, p.dayId, p.mealType)}`;
    case "restore_meal":
      return `加回${dayLabel(days, p.dayId)}的${MEAL_LABELS[p.mealType]}`;
    case "replace_accommodation":
      return `換掉${dayLabel(days, p.dayId)}的住宿（從候選清單挑）`;
    case "restructure": {
      const cities = (p.cities ?? []) as { name: string; days: number; isNew: boolean }[];
      return `調整城市：${cities.map((c) => `${c.name} ${c.days} 天${c.isNew ? "（新）" : ""}`).join(" → ")}`;
    }
    default:
      return "修改行程";
  }
}

/** A transport card: from which stop to which, and the stored line (a Routes time, never the model's). */
export function transportCard(days: Day[], ref: StopRef): { title: string; text: string } | null {
  const at = locate(days, ref);
  if (!at || at.stopNumber < 2) return null;
  const day = days[at.dayNumber - 1];
  const from = day.stops[at.stopNumber - 2];
  const fromLabel = `第${at.stopNumber - 1}站${from.name ? `「${from.name}」` : ""}`;
  const toLabel = `第${at.stopNumber}站${at.name ? `「${at.name}」` : ""}`;
  return {
    title: `第${at.dayNumber}天：${fromLabel} → ${toLabel}`,
    text: day.stops[at.stopNumber - 1].transport_from_prev ?? "交通方式還沒算好",
  };
}

/** The place ID behind a stop, for its 「照片與詳情」. */
export function placeIdOf(days: Day[], ref: StopRef): string | undefined {
  const at = locate(days, ref);
  return at ? days[at.dayNumber - 1].stops[at.stopNumber - 1].placeId : undefined;
}
