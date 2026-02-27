import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      id: itinerary.id,
      data: {
        title: itinerary.title,
        days: itinerary.days,
      },
      config: itinerary.config,
      createdAt: itinerary.createdAt,
    });
  } catch (error) {
    console.error("[Itinerary GET Error]", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
