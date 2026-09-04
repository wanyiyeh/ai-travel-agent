"use client";

import { useSortable, type UseSortableArguments } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Thin wrapper around dnd-kit's useSortable that also composes the
 * transform/transition into a ready-to-spread `style` object — the part of
 * the hook's return value every sortable item (stop cards, restructure city
 * cards) needs identically. Callers still get the raw sortable fields back
 * for anything item-specific (isDragging-driven opacity, drag-handle markup).
 */
export function useSortableItem(id: string, options?: Omit<UseSortableArguments, "id">) {
  const sortable = useSortable({ id, ...options });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return { ...sortable, style };
}
