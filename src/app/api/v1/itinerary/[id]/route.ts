import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const IATA_CURRENCY: Record<string, string> = {
  // Japan
  NRT: "JPY", HND: "JPY", KIX: "JPY", NGO: "JPY", CTS: "JPY", FUK: "JPY", OKA: "JPY",
  // Korea
  ICN: "KRW", GMP: "KRW", PUS: "KRW",
  // China
  PEK: "CNY", PKX: "CNY", PVG: "CNY", SHA: "CNY", CAN: "CNY",
  // Hong Kong
  HKG: "HKD",
  // Singapore
  SIN: "SGD",
  // Australia
  SYD: "AUD", MEL: "AUD", BNE: "AUD", PER: "AUD", ADL: "AUD",
  // New Zealand
  AKL: "NZD", CHC: "NZD",
  // Thailand
  BKK: "THB", DMK: "THB", HKT: "THB", CNX: "THB",
  // Vietnam
  SGN: "VND", HAN: "VND", DAD: "VND",
  // Malaysia
  KUL: "MYR", JHB: "MYR",
  // Indonesia
  DPS: "IDR", CGK: "IDR",
  // Cambodia
  REP: "USD", PNH: "USD",
  // UK
  LHR: "GBP", LGW: "GBP", MAN: "GBP", EDI: "GBP",
  // Eurozone
  CDG: "EUR", ORY: "EUR", AMS: "EUR", FRA: "EUR", MUC: "EUR", BER: "EUR",
  VIE: "EUR", FCO: "EUR", MXP: "EUR", BCN: "EUR", MAD: "EUR", LIS: "EUR",
  ATH: "EUR", HEL: "EUR", CPH: "DKK", ARN: "SEK", OSL: "NOK",
  PRG: "CZK", BUD: "HUF", WAW: "PLN", ZRH: "CHF", GVA: "CHF",
  // Turkey
  IST: "TRY", SAW: "TRY",
  // UAE
  DXB: "AED", AUH: "AED",
  // Qatar
  DOH: "QAR",
  // USA
  JFK: "USD", LAX: "USD", SFO: "USD", ORD: "USD", MIA: "USD", SEA: "USD",
  // Canada
  YYZ: "CAD", YVR: "CAD", YUL: "CAD",
};

function inferCurrency(flightInfo: unknown): string | undefined {
  if (!flightInfo || typeof flightInfo !== "object") return undefined;
  const fi = flightInfo as Record<string, unknown>;
  const iata = (fi.arrivalCity ?? fi.returnDepartureCity) as string | undefined;
  return iata ? IATA_CURRENCY[iata] : undefined;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.itinerary.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Itinerary DELETE Error]", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

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

    const config = (itinerary.config && typeof itinerary.config === "object"
      ? itinerary.config
      : {}) as Record<string, unknown>;
    return NextResponse.json({
      success: true,
      id: itinerary.id,
      data: {
        title: itinerary.title,
        currency: (config.currency as string | null | undefined) ?? inferCurrency(config.flightInfo) ?? undefined,
        days: itinerary.days,
      },
      config,
      createdAt: itinerary.createdAt,
    });
  } catch (error) {
    console.error("[Itinerary GET Error]", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
