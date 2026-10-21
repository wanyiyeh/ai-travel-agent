"use client";

import { useState } from "react";

interface PlacePhotoThumbProps {
  placeId?: string | null;
  photoName?: string | null;
  size?: number;
  className?: string;
}

// Not every place has a Google Places photo — render nothing rather than a
// broken-image icon when the proxy 404s.
//
// Only with a `photoName`: a place read back from storage has none (photo
// names are Google content, ADR-0004) and its photo is shown in the place
// details view instead (ADR-0005), so asking the proxy would only 404.
// Candidates fresh from a search still carry one and keep their thumbnail.
export function PlacePhotoThumb({ placeId, photoName, size = 64, className = "" }: PlacePhotoThumbProps) {
  const [failed, setFailed] = useState(false);

  if (!placeId || !photoName || failed) return null;

  const params = new URLSearchParams({ maxWidthPx: String(size * 2), name: photoName });

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/v1/places/${placeId}/photo?${params.toString()}`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 object-cover rounded-lg bg-zinc-100 dark:bg-zinc-800 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
