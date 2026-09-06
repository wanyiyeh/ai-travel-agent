import type { ReactNode } from "react";
import { PlacePhotoThumb } from "@/components/PlacePhotoThumb";
import { Spinner } from "@/components/picker/Spinner";
import { ACCENT_STYLES, type Accent } from "@/components/picker/accent";

interface CandidateCardProps {
  accent: Accent;
  photoPlaceId?: string;
  photoName?: string | null;
  name: string;
  rating?: number | null;
  isCurrent?: boolean;
  currentLabel?: string;
  /** Extra inline badges rendered right after the rating (price level, distance, "suspicious", ...). */
  badges?: ReactNode;
  addressLine?: string;
  /** Description / cost / duration lines rendered below the address. */
  children?: ReactNode;
  selecting: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function CandidateCard({
  accent,
  photoPlaceId,
  photoName,
  name,
  rating,
  isCurrent,
  currentLabel = "目前",
  badges,
  addressLine,
  children,
  selecting,
  disabled,
  onClick,
}: CandidateCardProps) {
  const styles = ACCENT_STYLES[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-lg border p-3 transition-colors disabled:opacity-50 bg-white dark:bg-zinc-900 ${
        isCurrent ? styles.cardCurrent : styles.cardHover
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <PlacePhotoThumb placeId={photoPlaceId} photoName={photoName} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{name}</p>
            {rating != null && (
              <span className="text-xs text-amber-600 dark:text-amber-400">{rating}★</span>
            )}
            {badges}
            {isCurrent && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${styles.badge}`}
              >
                {currentLabel}
              </span>
            )}
          </div>
          {addressLine && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-1 mt-0.5">{addressLine}</p>
          )}
          {children}
        </div>
        {selecting && <Spinner className={`w-4 h-4 ${styles.spinner}`} />}
      </div>
    </button>
  );
}
