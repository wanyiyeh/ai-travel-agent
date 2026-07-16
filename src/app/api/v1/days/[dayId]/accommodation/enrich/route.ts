import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { iataToCity } from "@/lib/iataCity";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { searchPlaceText, getCityCenter } from "@/lib/placesTextSearch";
import { PRICE_LEVEL_MAP } from "@/lib/fetchCityRestaurants";
import { estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";

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

    const config = itinerary.config as {
      flightInfo?: { arrivalCity?: string };
      currency?: string;
    };

    const accName = typeof accommodation.name === "string" ? accommodation.name : undefined;
    const accArea = typeof accommodation.area === "string" ? accommodation.area : undefined;

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
    }

    // Derive city name from waypointCity tag or IATA arrival code
    const waypointCity = typeof day.waypointCity === "string" ? day.waypointCity : undefined;
    const iataCity = config.flightInfo?.arrivalCity
      ? iataToCity(config.flightInfo.arrivalCity)
      : undefined;
    const cityHint = waypointCity ?? iataCity ?? "";

    // Build a precise query: prefer hotel name, fall back to "hotel in area, city"
    const query = accName
      ? `${accName} ${accArea ?? ""} ${cityHint}`.trim()
      : `hotel ${accArea ?? ""} ${cityHint}`.trim();

    const cityBias = await getCityCenter(cityHint, apiKey);

    // Check cache before hitting Google API
    const cached = await lookupByQuery(query);
    let placeId: string;
    let placeName: string;
    let placeAddress: string | null;
    let placeLat: number;
    let placeLng: number;
    let placeRating: number | null;
    let placePriceLevel: number | null = null;

    if (cached && cached.lat != null && cached.lng != null) {
      placeId = cached.placeId;
      placeName = cached.name;
      placeAddress = cached.address;
      placeLat = cached.lat;
      placeLng = cached.lng;
      placeRating = cached.rating;
    } else {
      const place = await searchPlaceText(query, apiKey, cityBias);
      if (!place) {
        return NextResponse.json(
          { error: "Accommodation not found on Google Maps" },
          { status: 404 }
        );
      }
      placeId = place.id;
      placeName = place.displayName.text;
      placeAddress = place.formattedAddress;
      placeLat = place.location.latitude;
      placeLng = place.location.longitude;
      placeRating = place.rating ?? null;
      placePriceLevel = place.priceLevel ? (PRICE_LEVEL_MAP[place.priceLevel] ?? null) : null;
      await upsertPlace(query, { placeId: place.id, name: place.displayName.text, address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating });
    }

    const estimatedCost = estimateLodgingCostPerNight(config.currency, placePriceLevel);
    const costRange = estimateLodgingCostRange(config.currency, placePriceLevel);

    const enriched = {
      ...accommodation,
      name: accName ?? placeName,
      placeId,
      lat: placeLat,
      lng: placeLng,
      address: placeAddress,
      rating: placeRating,
      priceLevel: placePriceLevel,
      ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
      ...(costRange !== undefined
        ? { estimated_cost_low: costRange[0], estimated_cost_high: costRange[1] }
        : {}),
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
