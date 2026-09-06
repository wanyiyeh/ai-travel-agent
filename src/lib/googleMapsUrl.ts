// Shared builders for the Google Maps links scattered across the itinerary
// UI (stop cards, meal cards, accommodation cards, the map's route click
// handler) — previously three different URL shapes were hand-rolled per
// call site (one keyed off place names, one off lat/lng via a manually
// built URL, one off a raw place_id query string).

export function buildPlaceMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

export function buildSearchMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
}

/**
 * A driving-directions link through an ordered list of stops. Each point can
 * be a place name/address or a "lat,lng" string — Google Maps accepts both
 * in the same URL. `travelMode` is omitted by default (Google picks driving).
 */
export function buildDirectionsUrl(points: string[], travelMode?: "driving" | "walking" | "transit" | "bicycling"): string {
  const [origin, ...rest] = points;
  const destination = rest.pop();
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  if (origin) url.searchParams.set("origin", origin);
  if (destination) url.searchParams.set("destination", destination);
  if (rest.length > 0) url.searchParams.set("waypoints", rest.join("|"));
  if (travelMode) url.searchParams.set("travelmode", travelMode);
  return url.toString();
}
