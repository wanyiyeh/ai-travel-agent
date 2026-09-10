import { NextResponse } from "next/server";
import { z } from "zod";
import { getCityCenter } from "@/lib/placesTextSearch";

const RequestSchema = z.object({
  cityNames: z.array(z.string().min(1)).min(1),
});

// Resolves a batch of city names to coordinates, purely so the restructure
// flow can place newly-added cities next to their geographic neighbor instead
// of always appending to the end of the list. Backed by getCityCenter's
// existing PlaceQuery cache, so re-opening the same trip's restructure panel
// doesn't re-bill Google for cities it has already resolved once.
export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
  }

  const body = await request.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const uniqueNames = Array.from(new Set(parsed.data.cityNames));
  const centers: Record<string, { lat: number; lng: number } | null> = {};

  // getCityCenter already degrades quota/transient Places API failures to
  // null rather than throwing, so one bad lookup can't fail the whole batch —
  // the frontend just treats that city as coordinate-less and falls back to
  // appending new cities at the end, same as before this feature existed.
  await Promise.all(
    uniqueNames.map(async (name) => {
      centers[name] = await getCityCenter(name, apiKey);
    }),
  );

  return NextResponse.json({ centers });
}
