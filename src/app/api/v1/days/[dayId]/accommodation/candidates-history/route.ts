import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { AccommodationCandidate } from "@/types/itinerary";
import { internalErrorResponse } from "@/lib/apiError";

const PAGE_SIZE = 3;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const url = new URL(request.url);
    const itineraryId = url.searchParams.get("itineraryId");
    const cursor = url.searchParams.get("cursor");

    if (!itineraryId) {
      return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
    }

    const logs = await prisma.accommodationCandidateLog.findMany({
      where: { itineraryId, dayId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = logs.length > PAGE_SIZE;
    const page = hasMore ? logs.slice(0, PAGE_SIZE) : logs;

    const history = page.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      candidates: JSON.parse(log.candidates) as AccommodationCandidate[],
    }));

    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return NextResponse.json({ success: true, history, nextCursor });
  } catch (error) {
    return internalErrorResponse("Accommodation Candidates History Error", error, "Failed to fetch accommodation candidate history");
  }
}
