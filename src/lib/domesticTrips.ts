import { AIRPORTS, iataToCity } from "@/lib/airports";
import { haversineKm } from "@/lib/geo";
import type { DayFixedEvents } from "@/lib/fixedEvents";
import type { FlightInfo } from "@/lib/schemas";

// 國內旅遊 (plan/form-preference-wiring.md 1.10, phase 5a). A domestic trip
// borrows the flight fields: departureCity is home, arrivalCity /
// returnDepartureCity are TW-xxx places (airports.ts), returnArrivalCity is
// home again. The traveler gives when they leave home and get back; this
// works out arrivalTime / returnDepartureTime from the journey, so the rest
// of the pipeline plans a domestic trip exactly as it plans a flight.
//
// Journey times are rough estimates from straight-line distance, not a
// timetable — the stops say 「估計」.

export function isDomestic(flightInfo: Pick<FlightInfo, "tripType">): boolean {
  return flightInfo.tripType === "domestic";
}

// After arriving: a few minutes from the station or car park, not 90 for
// immigration and bags. Before leaving: half an hour, not 3 hours for check-in.
export const DOMESTIC_ARRIVAL_BUFFER_MINUTES = 15;
export const DOMESTIC_DEPARTURE_BUFFER_MINUTES = 30;

// 高鐵 stops. Between two of them, public transport means the 高鐵.
const HSR = new Set(["TW-TPE", "TW-TYN", "TW-HSZ", "TW-TXG", "TW-CYI", "TW-TNN", "TW-KHH"]);
// Places public transport reaches by bus from a hub town.
const BUS_FROM: Record<string, { hub: string; minutes: number }> = {
  "TW-SML": { hub: "TW-TXG", minutes: 100 },
  "TW-CJG": { hub: "TW-TXG", minutes: 150 },
  "TW-ALS": { hub: "TW-CYI", minutes: 150 },
  "TW-KTG": { hub: "TW-KHH", minutes: 150 },
  "TW-JFN": { hub: "TW-TPE", minutes: 70 },
};
// Mountain and east-coast roads are slow: the straight line undersells them.
const SLOW_ROADS = new Set(["TW-HUN", "TW-TTT", "TW-SML", "TW-CJG", "TW-ALS", "TW-KTG"]);

type IslandRoute = { mode: "飛機" | "船"; from: string; port: string; minutes: number; landMinutes?: number };
// Outlying islands: by plane or boat from a gateway town. Several routes: the
// quickest from home is taken.
export const ISLAND_ACCESS: Record<string, IslandRoute[]> = {
  "TW-PEH": [
    { mode: "飛機", from: "TW-TPE", port: "松山機場", minutes: 50 },
    { mode: "飛機", from: "TW-TXG", port: "台中機場", minutes: 40 },
    { mode: "飛機", from: "TW-KHH", port: "高雄機場", minutes: 40 },
    { mode: "船", from: "TW-CYI", port: "嘉義布袋港", minutes: 90 },
  ],
  "TW-KNH": [
    { mode: "飛機", from: "TW-TPE", port: "松山機場", minutes: 60 },
    { mode: "飛機", from: "TW-TXG", port: "台中機場", minutes: 55 },
    { mode: "飛機", from: "TW-KHH", port: "高雄機場", minutes: 60 },
  ],
  "TW-MZU": [{ mode: "飛機", from: "TW-TPE", port: "松山機場", minutes: 50 }],
  "TW-GDI": [{ mode: "船", from: "TW-TTT", port: "台東富岡漁港", minutes: 50 }],
  "TW-LYU": [
    { mode: "飛機", from: "TW-TTT", port: "台東機場", minutes: 25 },
    { mode: "船", from: "TW-TTT", port: "台東富岡漁港", minutes: 150 },
  ],
  // 東港 is about an hour's drive or bus from 高雄.
  "TW-XLQ": [{ mode: "船", from: "TW-KHH", port: "東港碼頭", minutes: 25, landMinutes: 60 }],
};
// Check-in or boarding time before a plane or boat.
const BOARDING_MINUTES = { 飛機: 60, 船: 30 } as const;
// The boats to these two stop in rough winter seas.
const WINTER_FERRY = new Set(["TW-GDI", "TW-LYU"]);

export type Journey = { minutes: number; how: string };

const kmBetween = (a: string, b: string) => {
  const pa = AIRPORTS[a];
  const pb = AIRPORTS[b];
  return pa && pb ? haversineKm(pa.lat, pa.lng, pb.lat, pb.lng) : 0;
};

/** A journey on Taiwan's main island, by car or public transport. */
export function landJourney(from: string, to: string, selfDrive: boolean): Journey {
  if (from === to) return { minutes: 0, how: "" };
  const km = kmBetween(from, to);
  if (selfDrive) {
    const slow = SLOW_ROADS.has(from) || SLOW_ROADS.has(to);
    return { minutes: Math.round(km * (slow ? 1.3 : 0.8) + 15), how: "開車" };
  }
  // A bus town at either end: rail to its hub, then the bus.
  const busEnd = BUS_FROM[to] ? to : BUS_FROM[from] ? from : undefined;
  if (busEnd) {
    const { hub, minutes } = BUS_FROM[busEnd];
    const other = busEnd === to ? from : to;
    const rail = landJourney(other, hub, false);
    const how = rail.minutes ? `${rail.how}到${iataToCity(hub)}，再轉客運` : "搭客運";
    return { minutes: rail.minutes + minutes, how };
  }
  if (HSR.has(from) && HSR.has(to)) return { minutes: Math.round(km * 0.3 + 25), how: "搭高鐵" };
  return { minutes: Math.round(km * 1.2 + 20), how: "搭台鐵或客運" };
}

/** Home to a destination (or back), by plane or boat for an island, the quickest way. */
export function journey(from: string, to: string, selfDrive: boolean): Journey {
  const island = ISLAND_ACCESS[to] ? to : ISLAND_ACCESS[from] ? from : undefined;
  if (!island) return landJourney(from, to, selfDrive);
  const mainland = island === to ? from : to;
  const options = ISLAND_ACCESS[island].map((route) => {
    const land = landJourney(mainland, route.from, selfDrive);
    const landMinutes = land.minutes + (route.landMinutes ?? 0);
    const reach = landMinutes ? `${land.how || "開車或搭車"}到${route.port}，` : "";
    return {
      minutes: landMinutes + BOARDING_MINUTES[route.mode] + route.minutes,
      how: `${reach}搭${route.mode === "飛機" ? "飛機" : "船"}`,
    };
  });
  return options.reduce((best, o) => (o.minutes < best.minutes ? o : best));
}

const minuteOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (minute: number) => {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} 小時 ${m} 分` : h ? `${h} 小時` : `${m} 分`;
};

const homeOf = (fi: FlightInfo) => fi.returnArrivalCity ?? fi.departureCity;

/**
 * A domestic trip's flight fields filled in from the journey: arrivalTime is
 * leaving home plus the way there, returnDepartureTime getting home minus
 * the way back. A trip abroad comes back unchanged.
 */
export function withDomesticTimes(fi: FlightInfo, selfDrive: boolean): FlightInfo {
  if (!isDomestic(fi)) return fi;
  const out = journey(fi.departureCity, fi.arrivalCity, selfDrive);
  const back = journey(fi.returnDepartureCity, homeOf(fi), selfDrive);
  return {
    ...fi,
    ...(fi.homeDepartureTime ? { arrivalTime: hhmm(minuteOf(fi.homeDepartureTime) + out.minutes) } : {}),
    ...(fi.homeArrivalTime ? { returnDepartureTime: hhmm(minuteOf(fi.homeArrivalTime) - back.minutes) } : {}),
  };
}

function islandNote(place: string): string {
  if (!AIRPORTS[place]?.island) return "";
  return WINTER_FERRY.has(place) ? "。出發前確認航班、船班，冬天常因東北季風停航" : "。出發前確認航班、船班";
}

/**
 * The way there on day 1 and home on the last day, as blocks the day plans
 * around: 「從台北前往台南：搭高鐵約 1 小時 45 分（估計）」.
 */
export function domesticJourneyEvents(
  fi: FlightInfo,
  selfDrive: boolean
): { outbound?: DayFixedEvents[number]; homebound?: DayFixedEvents[number] } {
  if (!isDomestic(fi)) return {};
  const home = homeOf(fi);
  const event = (from: string, to: string, startMinute: number, j: Journey, island: string) => ({
    block: { startMinute, endMinute: startMinute + j.minutes },
    stop: {
      id: crypto.randomUUID(),
      name: `從${iataToCity(from)}前往${iataToCity(to)}`,
      description: `${j.how}約 ${duration(j.minutes)}（估計）${islandNote(island)}`,
      duration_minutes: j.minutes,
      time_of_day: startMinute < 12 * 60 ? "morning" : startMinute < 18 * 60 ? "afternoon" : "evening",
      // Pinned like a booking: the scheduler keeps it, and nothing swaps it for a sight.
      fixedEvent: { type: "other", startTime: hhmm(startMinute), endTime: hhmm(startMinute + j.minutes) },
    },
  });
  const out = journey(fi.departureCity, fi.arrivalCity, selfDrive);
  const back = journey(fi.returnDepartureCity, home, selfDrive);
  return {
    ...(fi.homeDepartureTime && out.minutes
      ? { outbound: event(fi.departureCity, fi.arrivalCity, minuteOf(fi.homeDepartureTime), out, fi.arrivalCity) }
      : {}),
    ...(fi.homeArrivalTime && back.minutes
      ? { homebound: event(fi.returnDepartureCity, home, minuteOf(fi.homeArrivalTime) - back.minutes, back, fi.returnDepartureCity) }
      : {}),
  };
}

/** The trip's route for a prompt: abroad, the flights; at home, the towns. */
export function routeDescription(fi: FlightInfo): string {
  const arrival = iataToCity(fi.arrivalCity);
  const leaving = iataToCity(fi.returnDepartureCity);
  if (isDomestic(fi)) {
    const home = iataToCity(homeOf(fi));
    return arrival === leaving
      ? `台灣國內旅遊：從${home}出發前往${arrival}，結束後從${arrival}回${home}`
      : `台灣國內旅遊：從${home}出發前往${arrival}，旅途結束後從${leaving}回${home}`;
  }
  return arrival === leaving ? `從台灣出發飛往${arrival}來回` : `從台灣出發飛往${arrival}，旅途結束後從${leaving}搭機返回`;
}
