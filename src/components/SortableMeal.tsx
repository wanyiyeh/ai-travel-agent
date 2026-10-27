"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useSortableItem } from "@/hooks/useSortableItem";

/**
 * Lunch, snack or dinner as an item in the day's sortable list (ADR-0010).
 * The row draws its own handle, so this hands it the drag props, or nothing
 * when the meal can't be dragged right now.
 */
export function SortableMeal({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (dragHandle: HTMLAttributes<HTMLDivElement> | undefined) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging, style } = useSortableItem(id, { disabled });
  const handle = disabled ? undefined : ({ ...attributes, ...listeners } as HTMLAttributes<HTMLDivElement>);
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-30" : undefined}>
      {children(handle)}
    </div>
  );
}
