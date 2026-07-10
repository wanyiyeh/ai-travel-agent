import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { AccommodationCandidate } from "@/types/itinerary";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const itineraryId = new URL(request.url).searchParams.get("itineraryId");

    if (!itineraryId) {
      return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
    }

    const logs = await prisma.accommodationCandidateLog.findMany({
      where: { itineraryId, dayId },
      orderBy: { createdAt: "desc" },
    });

    const history = logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      candidates: JSON.parse(log.candidates) as AccommodationCandidate[],
    }));

    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error("[Accommodation Candidates History Error]", error);
    return NextResponse.json(
      { error: "Failed to fetch accommodation candidate history", details: String(error) },
      { status: 500 }
    );
  }
}
