import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const PLACES_API_BASE = "https://places.googleapis.com/v1";
const DEFAULT_MAX_WIDTH_PX = 800;
// Places API caps photo requests at 4800px on the long edge.
const MAX_WIDTH_PX_CAP = 1600;

// Google's signed photoUri is valid for ~60 minutes. Without this, every
// <img> load — including repeat ones from a different browser/incognito
// window, or a hard refresh that bypasses the browser's own HTTP cache —
// re-hits the billable Photo Media endpoint for a photo we already resolved
// moments ago. Cache the resolved URI in-process, keyed by exactly what
// makes it a distinct Google request (photo + width), so only the first
// request per photo per ~50min actually calls Google.
const PHOTO_URI_TTL_MS = 50 * 60 * 1000;
const photoUriCache = new Map<string, { photoUri: string; expiresAt: number }>();

async function resolvePhotoUri(photoName: string, maxWidthPx: number, apiKey: string): Promise<string | null> {
  const cacheKey = `${photoName}:${maxWidthPx}`;
  const cached = photoUriCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.photoUri;
  }

  const mediaUrl = `${PLACES_API_BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}&skipHttpRedirect=true`;
  const res = await fetch(mediaUrl);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.photoUri) return null;

  photoUriCache.set(cacheKey, { photoUri: data.photoUri, expiresAt: Date.now() + PHOTO_URI_TTL_MS });
  return data.photoUri;
}

// Keeps GOOGLE_PLACES_API_KEY server-side: the browser hits this route, which
// asks Google for a short-lived signed media URL and redirects there, instead
// of the client calling the Photo Media endpoint (and the key) directly.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ placeId: string }> }
) {
  const { placeId } = await params;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);

  // Picker candidates carry their own `photos[0].name` before they've ever
  // been upserted into the Place cache (that only happens on select/enrich),
  // so a caller can pass it directly instead of relying on a DB lookup that
  // would 404 for a place nobody has picked yet.
  let photoName = searchParams.get("name");
  if (!photoName) {
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    photoName = place?.photoName ?? null;
  }
  if (!photoName) {
    return NextResponse.json({ error: "No photo available for this place" }, { status: 404 });
  }

  const requestedWidth = Number(searchParams.get("maxWidthPx"));
  const maxWidthPx =
    Number.isFinite(requestedWidth) && requestedWidth > 0
      ? Math.min(requestedWidth, MAX_WIDTH_PX_CAP)
      : DEFAULT_MAX_WIDTH_PX;

  const photoUri = await resolvePhotoUri(photoName, maxWidthPx, apiKey);
  if (!photoUri) {
    return NextResponse.json({ error: "Failed to fetch photo from Google" }, { status: 502 });
  }

  return NextResponse.redirect(photoUri, {
    status: 302,
    headers: { "Cache-Control": "public, max-age=3000" },
  });
}
