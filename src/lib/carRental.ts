import { searchTextCandidates } from "@/lib/fetchCityRestaurants";
import { getIataCoords } from "@/lib/airports";
import { isInJapan } from "@/lib/transitEstimate";
import type { DayFixedEvents, Venue } from "@/lib/fixedEvents";

// 自駕 (plan/form-preference-wiring.md 1.7): a car rented at the arrival
// airport for the whole trip, returned at the departure airport.

const PICKUP_MINUTES = 45;
export const RETURN_CAR_MINUTES = 30;

/**
 * A car rental counter at the airport, by Text Search with the airport code
 * (Pro fields, cached 30 days, misses included). Not a Nearby Search around
 * AIRPORTS' coordinates: several are city centers (NRT is Tokyo Station), so
 * that found offices downtown.
 */
export async function findCarRental(iata: string): Promise<Venue | undefined> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const coords = getIataCoords(iata);
  if (!apiKey || !coords) return undefined;
  // Some airports are well outside the city whose center AIRPORTS holds (新千歲
  // is ~40km from Sapporo); the query names the airport, the bias stays at
  // Google's 50km maximum.
  const [place] = await searchTextCandidates(`${iata} airport car rental`, coords, apiKey, 50000, "car_rental");
  return place ? { placeId: place.placeId, name: place.name, lat: place.lat, lng: place.lng, address: place.address } : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

function rentalStop(name: string, description: string, startMinute: number, minutes: number, rental: Venue | undefined) {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    duration_minutes: minutes,
    time_of_day: startMinute < 12 * 60 ? "morning" : startMinute < 18 * 60 ? "afternoon" : "evening",
    // Pinned like a booked event: not something to swap for an attraction.
    fixedEvent: { type: "other", startTime: hhmm(startMinute), endTime: hhmm(startMinute + minutes) },
    ...(rental ? { placeId: rental.placeId, lat: rental.lat, lng: rental.lng, address: rental.address } : {}),
  };
}

/**
 * Day 1's car pickup, as a block at the start of the day, with reminders: a
 * license (Japan needs a Japanese translation of a Taiwanese one) and the
 * one-way fee when the car goes back at another airport.
 */
export function carPickup(
  rental: Venue | undefined,
  startMinute: number,
  { arrivalIata, returnIata }: { arrivalIata: string; returnIata: string }
): DayFixedEvents[number] {
  const airport = getIataCoords(arrivalIata);
  const notes = [
    "抵達後到機場領取租車",
    airport && isInJapan(airport.lat, airport.lng) ? "記得帶國際駕照或駕照日文譯本" : "記得帶國際駕照",
    ...(arrivalIata !== returnIata ? ["在不同機場還車（甲租乙還）通常要另付費用"] : []),
  ];
  return {
    block: { startMinute, endMinute: startMinute + PICKUP_MINUTES },
    stop: rentalStop(`機場取車：${rental?.name ?? "租車公司"}`, notes.join("。"), startMinute, PICKUP_MINUTES, rental),
  };
}

/** The last day's car return, right before heading in for the flight. */
export function carReturnStop(rental: Venue | undefined, startMinute: number): Record<string, unknown> {
  return rentalStop(`機場還車：${rental?.name ?? "租車公司"}`, "搭機前還車，記得加滿油", startMinute, RETURN_CAR_MINUTES, rental);
}
