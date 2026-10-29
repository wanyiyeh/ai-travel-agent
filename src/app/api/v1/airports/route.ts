import { NextResponse } from "next/server";
import { lookupAirport } from "@/lib/airportIndex";
import generatedAirports from "@/data/airports.generated.json";
import type { AirportOption } from "@/lib/airportOptions";

// Every generated airport for the home page's picker (PLAN-003), hand-kept
// ones included so the client can search them by English name too ("tokyo",
// "reykjavik"); the client keeps its own names for those. No coordinates.
// Built once at build time: the data only changes with a deploy.
export const dynamic = "force-static";

export function GET() {
  const options: AirportOption[] = Object.keys(generatedAirports).flatMap((code) => {
    const airport = lookupAirport(code);
    return airport ? [{ code, name: airport.cityZh, nameEn: airport.cityEn ?? airport.cityZh, country: airport.countryZh ?? "" }] : [];
  });
  return NextResponse.json(options);
}
