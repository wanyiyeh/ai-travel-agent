import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Mirrors trash/[deletedStopId]/route.ts — permanently purges a trashed day.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; deletedDayId: string }> }
) {
  try {
    const { id, deletedDayId } = await params;

    const entry = await prisma.deletedDay.findUnique({ where: { id: deletedDayId } });
    if (!entry || entry.itineraryId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.deletedDay.delete({ where: { id: deletedDayId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Trash Day DELETE Error]", error);
    return NextResponse.json({ error: "Failed to permanently delete" }, { status: 500 });
  }
}
