import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isMockPlaces, mockPhotoSvg } from "@/lib/mockPlaces";
import { isValidPhotoName } from "@/lib/placePhotoName";

const PLACES_API_BASE = "https://places.googleapis.com/v1";
const DEFAULT_MAX_WIDTH_PX = 800;
// Every distinct width is a separate billable Photo Media request (and cache
// entry), so an arbitrary ?maxWidthPx= would let a caller re-bill the same
// photo up to 1600 times. Round the request up to a fixed set of widths
// instead; the browser scales the image down to the rendered size anyway.
// Places API itself caps photo requests at 4800px on the long edge.
const WIDTH_BUCKETS_PX = [128, 256, 512, 800, 1600];

function bucketWidth(requestedWidth: number): number {
  if (!Number.isFinite(requestedWidth) || requestedWidth <= 0) return DEFAULT_MAX_WIDTH_PX;
  return WIDTH_BUCKETS_PX.find((w) => w >= requestedWidth) ?? WIDTH_BUCKETS_PX[WIDTH_BUCKETS_PX.length - 1];
}

// Google's signed photoUri is valid for ~60 minutes. Without this, every
// <img> load — including repeat ones from a different browser/incognito
// window, or a hard refresh that bypasses the browser's own HTTP cache —
// re-hits the billable Photo Media endpoint for a photo we already resolved
// moments ago. Cache the resolved URI in-process, keyed by exactly what
// makes it a distinct Google request (photo + width), so only the first
// request per photo per ~50min actually calls Google.
const PHOTO_URI_TTL_MS = 50 * 60 * 1000;
// Bounded so a flood of distinct photo names can't grow this without limit.
// Map iteration order is insertion order, so the first key is the oldest.
const PHOTO_URI_CACHE_MAX_ENTRIES = 2000;
const photoUriCache = new Map<string, { photoUri: string; expiresAt: number }>();

function cachePhotoUri(cacheKey: string, photoUri: string) {
  photoUriCache.delete(cacheKey);
  if (photoUriCache.size >= PHOTO_URI_CACHE_MAX_ENTRIES) {
    const oldestKey = photoUriCache.keys().next().value;
    if (oldestKey !== undefined) photoUriCache.delete(oldestKey);
  }
  photoUriCache.set(cacheKey, { photoUri, expiresAt: Date.now() + PHOTO_URI_TTL_MS });
}

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

  cachePhotoUri(cacheKey, data.photoUri);
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
  const { searchParams } = new URL(request.url);

  // Picker candidates carry their own `photos[0].name` before they've ever
  // been upserted into the Place cache (that only happens on select/enrich),
  // so a caller can pass it directly instead of relying on a DB lookup that
  // would 404 for a place nobody has picked yet. Checked before the mock
  // short-circuit so `dev:mock` exercises the same rejection path.
  const requestedPhotoName = searchParams.get("name");
  if (requestedPhotoName && !isValidPhotoName(requestedPhotoName, placeId)) {
    return NextResponse.json({ error: "Invalid photo name" }, { status: 400 });
  }

  // MOCK_PLACES: serve a placeholder instead of calling the billable Photo
  // Media endpoint (a redirect to a data: URL would be blocked by browsers).
  if (isMockPlaces()) {
    return new NextResponse(mockPhotoSvg(placeId), {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3000" },
    });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
  }

  let photoName = requestedPhotoName;
  if (!photoName) {
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    photoName = place?.photoName ?? null;
  }
  // The cached name came from Google, but it's spliced into the same keyed
  // URL, so hold it to the same shape rather than trusting the DB blindly.
  if (!photoName || !isValidPhotoName(photoName, placeId)) {
    return NextResponse.json({ error: "No photo available for this place" }, { status: 404 });
  }

  const maxWidthPx = bucketWidth(Number(searchParams.get("maxWidthPx")));

  const photoUri = await resolvePhotoUri(photoName, maxWidthPx, apiKey);
  if (!photoUri) {
    return NextResponse.json({ error: "Failed to fetch photo from Google" }, { status: 502 });
  }

  return NextResponse.redirect(photoUri, {
    status: 302,
    headers: { "Cache-Control": "public, max-age=3000" },
  });
}
