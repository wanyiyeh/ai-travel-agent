import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; deletedStopId: string }> }
) {
  try {
    const { id, deletedStopId } = await params;

    const entry = await prisma.deletedStop.findUnique({ where: { id: deletedStopId } });
    if (!entry || entry.itineraryId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.deletedStop.delete({ where: { id: deletedStopId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Trash DELETE Error]", error);
    return NextResponse.json({ error: "Failed to permanently delete" }, { status: 500 });
  }
}
