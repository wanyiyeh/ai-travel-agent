"use client";

import { KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * Shared dnd-kit sensor config for the itinerary's drag-to-reorder lists
 * (stops within a day, cities within the restructure wizard) — a small
 * pointer-move threshold so drags don't fire on a plain click/tap, plus a
 * touch delay so a scroll gesture isn't mistaken for a drag start.
 */
export function useItinerarySensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );
}
