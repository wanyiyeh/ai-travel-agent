import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";

const PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText";

const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

interface PlaceResult {
  id: string;
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  rating?: number;
  priceLevel?: string;
}

async function searchPlace(query: string): Promise<PlaceResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  const res = await fetch(PLACES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.priceLevel",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!res.ok) throw new Error(`Places API error: ${res.status}`);
  const data = await res.json();
  return data.places?.[0] ?? null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();
    const { itineraryId } = body;

    if (!itineraryId) {
      return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
    }

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = days.findIndex((d) => d.id === dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const accommodation = day.accommodation as Record<string, unknown> | undefined;

    if (!accommodation) {
      return NextResponse.json({ error: "No accommodation for this day" }, { status: 404 });
    }

    if (accommodation.placeId) {
      return NextResponse.json({ success: true, accommodation });
    }

    const query = `${accommodation.name} ${accommodation.area}`;
    const place = await searchPlace(query);

    if (!place) {
      return NextResponse.json(
        { error: "Accommodation not found on Google Maps" },
        { status: 404 }
      );
    }

    const config = itinerary.config as {
      flightInfo?: { departureDate?: string };
      preferences?: { travelers?: number };
    };

    const dayNumber = day.day as number;
    const travelers = config.preferences?.travelers ?? 2;

    const bookingParams = new URLSearchParams({
      ss: `${accommodation.name} ${accommodation.area}`,
      lang: "zh-tw",
      group_adults: String(travelers),
      no_rooms: "1",
    });

    const departureDate = config.flightInfo?.departureDate;
    if (departureDate) {
      const checkinDate = new Date(`${departureDate}T00:00:00`);
      checkinDate.setDate(checkinDate.getDate() + dayNumber - 1);
      const checkoutDate = new Date(checkinDate);
      checkoutDate.setDate(checkoutDate.getDate() + 1);
      bookingParams.set("checkin", checkinDate.toISOString().split("T")[0]);
      bookingParams.set("checkout", checkoutDate.toISOString().split("T")[0]);
    }

    const bookingUrl = `https://www.booking.com/search.html?${bookingParams.toString()}`;

    const enriched = {
      ...accommodation,
      placeId: place.id,
      lat: place.location.latitude,
      lng: place.location.longitude,
      address: place.formattedAddress,
      rating: place.rating ?? null,
      priceLevel: place.priceLevel ? (PRICE_LEVEL_MAP[place.priceLevel] ?? null) : null,
      bookingUrl,
    };

    days[dayIndex] = { ...day, accommodation: enriched };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, accommodation: enriched });
  } catch (error) {
    console.error("[Accommodation Enrich Error]", error);
    return NextResponse.json(
      { error: "Failed to enrich accommodation", details: String(error) },
      { status: 500 }
    );
  }
}
