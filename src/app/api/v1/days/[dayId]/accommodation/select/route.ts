import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { AccommodationSchema } from "@/lib/schemas";
import { getMockMode, mockDelay } from "@/lib/mockAi";
import { upsertPlace } from "@/lib/placeCache";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  accommodation: AccommodationSchema,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId, accommodation } = parsed.data;

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    // No AI/Places calls happen in this route (the candidate was already
    // fetched by /regenerate) — "slow" just adds latency for spinner testing,
    // "fixture" behaves identically to the real path since there's nothing to fake.
    if (mockMode === "slow") {
      await mockDelay(1500);
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

    if (accommodation.placeId && accommodation.lat != null && accommodation.lng != null) {
      const accName = accommodation.name ?? accommodation.area;
      await upsertPlace(`${accName} ${accommodation.area}`.trim(), {
        placeId: accommodation.placeId,
        name: accName,
        address: accommodation.address ?? null,
        lat: accommodation.lat,
        lng: accommodation.lng,
        rating: accommodation.rating ?? null,
        photoName: accommodation.photoName ?? null,
      });
    }

    days[dayIndex] = { ...days[dayIndex], accommodation };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, accommodation });
  } catch (error) {
    console.error("[Accommodation Select Error]", error);
    return NextResponse.json(
      { error: "Failed to select accommodation", details: String(error) },
      { status: 500 }
    );
  }
}
