// Shared color tokens for the candidate-picker family (StopPicker,
// AccommodationPicker, MealPicker). Each picker keeps its own accent so the
// three stay visually distinguishable, but the actual Tailwind classes live
// here once instead of being re-typed in every component.
//
// Classes are written out in full (not built from template strings) so
// Tailwind's static scanner can find them.
export type Accent = "emerald" | "indigo" | "amber";

export const ACCENT_STYLES: Record<
  Accent,
  {
    panel: string;
    cardHover: string;
    cardCurrent: string;
    spinner: string;
    link: string;
    badge: string;
    historyBorder: string;
  }
> = {
  emerald: {
    panel: "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20",
    cardHover: "border-zinc-200 dark:border-zinc-700 hover:border-emerald-400 dark:hover:border-emerald-600",
    cardCurrent: "border-emerald-300 dark:border-emerald-700",
    spinner: "text-emerald-500",
    link: "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300",
    badge: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    historyBorder: "border-emerald-100 dark:border-emerald-900/50",
  },
  indigo: {
    panel: "border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20",
    cardHover: "border-zinc-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-600",
    cardCurrent: "border-indigo-300 dark:border-indigo-700",
    spinner: "text-indigo-500",
    link: "text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300",
    badge: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
    historyBorder: "border-indigo-100 dark:border-indigo-900/50",
  },
  amber: {
    panel: "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20",
    cardHover: "border-zinc-200 dark:border-zinc-700 hover:border-amber-400 dark:hover:border-amber-600",
    cardCurrent: "border-amber-300 dark:border-amber-700",
    spinner: "text-amber-500",
    link: "text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300",
    badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    historyBorder: "border-amber-100 dark:border-amber-900/50",
  },
};
