// The way between the airport and the city (plan/form-preference-wiring.md,
// 2026-10-11). The arrival day used to start a flat 90 minutes after landing
// and the return day to end a flat 3 hours before the flight, whatever the
// airport: enough for 羽田, not for 成田, over an hour from 東京 by itself.
//
// Minutes from each airport to its city's center by the usual airport train,
// bus or taxi — estimates, not routed. A trip that lands in one city and
// starts in another (関西 for 京都) takes longer than this. Airports not in
// the table get it from their distance to the centre (ADR-0011).
import { lookupAirport } from "@/lib/airportIndex";
import { haversineKm } from "@/lib/geo";

const TRANSFER_MINUTES: Record<string, number> = {
  // 日本、韓國
  NRT: 75, HND: 30, KIX: 60, NGO: 45, CTS: 45, FUK: 15, OKA: 20, ICN: 70, GMP: 35, PUS: 30,
  // 中國、港澳
  PEK: 50, PKX: 60, PVG: 50, SHA: 30, CAN: 45, HKG: 35,
  // 東南亞、南亞
  SIN: 30, KUL: 60, BKK: 45, DMK: 40, HKT: 45, CNX: 15, SGN: 30, HAN: 45, DAD: 15, DPS: 45, CGK: 60,
  REP: 20, PNH: 30, KTM: 30, PKR: 15, DEL: 45, BOM: 60, CMB: 60,
  // 大洋洲
  PER: 25, MEL: 30, SYD: 25, BNE: 25, AKL: 40,
  // 歐洲
  LHR: 50, LGW: 45, MAN: 25, EDI: 30, DUB: 30, CDG: 50, ORY: 40, LYS: 35, NCE: 20, AMS: 20, FRA: 20, MUC: 45,
  BER: 40, HAM: 25, VIE: 25, FCO: 40, MXP: 55, VCE: 45, NAP: 20, BCN: 30, MAD: 35, LIS: 25, ATH: 45, HEL: 30,
  CPH: 20, ARN: 40, OSL: 30, KEF: 50, PRG: 35, BUD: 40, BTS: 25, LJU: 30, ZAG: 30, DBV: 30, SJJ: 20, BEG: 30, SOF: 25,
  OTP: 40, WAW: 25, KRK: 25, ZRH: 15, GVA: 15, BRU: 25, IST: 60,
  // 中東、非洲
  DXB: 25, AUH: 35, DOH: 25, CAI: 45, CMN: 50, CPT: 25, JNB: 40,
  // 美洲
  JFK: 60, MIA: 25, LAX: 50, SFO: 35, ORD: 50, SEA: 40, YYZ: 40, YVR: 30,
};

/** Immigration and bags after landing. */
export const ARRIVAL_CLEARANCE_MINUTES = 60;
/** At the airport this long before the flight: check-in and security. */
export const CHECK_IN_MINUTES = 120;

// Fitted to the table above against each airport's distance from its
// centre (2026-10, 96 airports): off by about 6 minutes on average, most for
// cities with bad traffic (Mumbai, Jakarta, New York), which the table has.
const TRANSFER_BASE_MINUTES = 20;
const TRANSFER_MINUTES_PER_KM = 0.9;

/**
 * Minutes between an airport and its city's center: the table's, else from
 * the distance, to the nearest 5. Undefined for a code we don't know, or a
 * place in Taiwan, where a domestic trip has no airport transfer.
 */
export function airportTransferMinutes(iata: string): number | undefined {
  if (TRANSFER_MINUTES[iata] !== undefined) return TRANSFER_MINUTES[iata];
  const info = lookupAirport(iata);
  if (!info?.airport) return undefined;
  const km = haversineKm(info.airport.lat, info.airport.lng, info.lat, info.lng);
  return Math.round((TRANSFER_BASE_MINUTES + km * TRANSFER_MINUTES_PER_KM) / 5) * 5;
}
