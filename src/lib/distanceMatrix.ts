type TravelMode = "driving" | "walking" | "transit" | "bicycling";

export interface DistanceResult {
  distanceText: string;
  distanceMeters: number;
  durationText: string;
  durationSeconds: number;
}

type Location = { lat: number; lng: number } | string;

function formatLocation(loc: Location): string {
  return typeof loc === "string" ? loc : `${loc.lat},${loc.lng}`;
}

export async function getDistance(
  origin: Location,
  destination: Location,
  mode: TravelMode = "driving"
): Promise<DistanceResult | null> {
  const params = new URLSearchParams({
    origins: formatLocation(origin),
    destinations: formatLocation(destination),
    mode,
    key: process.env.GOOGLE_PLACES_API_KEY!,
  });

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`
    );
    const data = await res.json() as {
      rows?: { elements?: { status: string; distance?: { text: string; value: number }; duration?: { text: string; value: number } }[] }[];
    };

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") return null;

    return {
      distanceText: element.distance!.text,
      distanceMeters: element.distance!.value,
      durationText: element.duration!.text,
      durationSeconds: element.duration!.value,
    };
  } catch {
    return null;
  }
}

// Returns distance info for each consecutive pair of stops.
// Stops without coordinates are skipped (null returned for that pair).
export async function getDistancesForStopPairs(
  stops: { id: string; lat?: number | null; lng?: number | null }[],
  mode: TravelMode = "driving"
): Promise<(DistanceResult | null)[]> {
  const results = await Promise.all(
    stops.slice(1).map((stop, i) => {
      const prev = stops[i];
      if (!prev.lat || !prev.lng || !stop.lat || !stop.lng) return Promise.resolve(null);
      return getDistance(
        { lat: prev.lat, lng: prev.lng },
        { lat: stop.lat, lng: stop.lng },
        mode
      );
    })
  );
  return results;
}
