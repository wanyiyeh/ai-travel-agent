"use client";

import { useState } from "react";

interface PlacePhotoThumbProps {
  placeId?: string | null;
  photoName?: string | null;
  size?: number;
  className?: string;
}

// Not every place has a Google Places photo, and candidates can carry a
// `photoName` before that place is ever cached server-side — render nothing
// rather than a broken-image icon when the proxy 404s.
export function PlacePhotoThumb({ placeId, photoName, size = 64, className = "" }: PlacePhotoThumbProps) {
  const [failed, setFailed] = useState(false);

  if (!placeId || failed) return null;

  const params = new URLSearchParams({ maxWidthPx: String(size * 2) });
  if (photoName) params.set("name", photoName);

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
