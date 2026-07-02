import { getDistance } from "./distanceMatrix";
import type { Itinerary } from "@/types/itinerary";
import type { ValidationIssue } from "./validateItinerary";

// IATA airport → country name for stop name disambiguation
const IATA_COUNTRY: Record<string, string> = {
  NRT: "Japan", HND: "Japan", KIX: "Japan", NGO: "Japan",
  CTS: "Japan", FUK: "Japan", OKA: "Japan",
  ICN: "South Korea", GMP: "South Korea", PUS: "South Korea",
  PEK: "China", PKX: "China", PVG: "China", SHA: "China", CAN: "China",
  HKG: "Hong Kong",
  SIN: "Singapore",
  KUL: "Malaysia",
  BKK: "Thailand", DMK: "Thailand", HKT: "Thailand", CNX: "Thailand",
  SGN: "Vietnam", HAN: "Vietnam", DAD: "Vietnam",
  DPS: "Indonesia", CGK: "Indonesia",
  REP: "Cambodia", PNH: "Cambodia",
  SYD: "Australia", MEL: "Australia", BNE: "Australia", PER: "Australia",
  AKL: "New Zealand",
  LHR: "United Kingdom", LGW: "United Kingdom", STN: "United Kingdom",
  LTN: "United Kingdom", MAN: "United Kingdom", EDI: "United Kingdom",
  CDG: "France", ORY: "France",
  AMS: "Netherlands",
  FRA: "Germany", MUC: "Germany", BER: "Germany",
  VIE: "Austria",
  FCO: "Italy", CIA: "Italy", MXP: "Italy", LIN: "Italy",
  BCN: "Spain", MAD: "Spain",
  LIS: "Portugal",
  ATH: "Greece",
  HEL: "Finland",
  CPH: "Denmark",
  ARN: "Sweden",
  OSL: "Norway",
  PRG: "Czech Republic",
  BUD: "Hungary",
  WAW: "Poland", KRK: "Poland",
  ZRH: "Switzerland", GVA: "Switzerland",
  IST: "Turkey", SAW: "Turkey",
  DXB: "UAE", DWC: "UAE", AUH: "UAE",
  DOH: "Qatar",
  JFK: "USA", LGA: "USA", EWR: "USA", LAX: "USA", SFO: "USA",
  ORD: "USA", MDW: "USA", MIA: "USA", SEA: "USA",
  YYZ: "Canada", YVR: "Canada",
  TPE: "Taiwan", TSA: "Taiwan", KHH: "Taiwan",
};

// Warn if driving time between consecutive stops exceeds 90 minutes
const WARN_SECONDS = 90 * 60;

export async function validateGeography(
  itinerary: Itinerary,
  arrivalIata: string,
): Promise<ValidationIssue[]> {
  const country = IATA_COUNTRY[arrivalIata] ?? "";

  type Pair = { day: number; fromName: string; toName: string };
  const pairs: Pair[] = [];

  for (const day of itinerary.days) {
    if (day.isTransitDay) continue;
    for (let i = 1; i < day.stops.length; i++) {
      pairs.push({
        day: day.day,
        fromName: day.stops[i - 1].name,
        toName: day.stops[i].name,
      });
    }
  }

  if (pairs.length === 0) return [];

  const results = await Promise.all(
    pairs.map(({ fromName, toName }) => {
      const from = country ? `${fromName}, ${country}` : fromName;
      const to = country ? `${toName}, ${country}` : toName;
      return getDistance(from, to, "driving").catch(() => null);
    }),
  );

  const issues: ValidationIssue[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const result = results[i];
    if (!result || result.durationSeconds <= WARN_SECONDS) continue;
    const { day, fromName, toName } = pairs[i];
    issues.push({
      severity: "warning",
      code: "STOPS_TOO_FAR_APART",
      message: `第 ${day} 天：「${fromName}」→「${toName}」開車需 ${result.durationText}，同天安排可能過於緊湊`,
      day,
    });
  }

  return issues;
}
