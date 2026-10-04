import { AIRPORTS } from "@/lib/airports";
import { haversineKm } from "@/lib/geo";

/**
 * MOCK_PLACES=1 — fake every Google Places / Routes response so UI flows can
 * be clicked through without billing Google (see
 * plan/places-api-cost-reduction.md section 3). Unlike MOCK_AI, which
 * short-circuits 4 whole routes, this sits at the HTTP layer (googleFetch):
 * callers still run their real parsing, caching, filtering and scheduling
 * code — only the network response is fake.
 *
 * Fake results are deterministic (same request -> same answer) and
 * geographically plausible — placed around the request's own locationBias /
 * search circle, or a known city's coordinates — so the 80km suspicious-
 * distance checks don't flag everything.
 *
 * Must run against a separate database (see assertMockPlacesDatabase): the
 * app writes Text Search results into the PlaceQuery cache keyed by the real
 * query string, so a fake place landing in dev.db would keep being served
 * after mock mode is switched off.
 *
 * OpenAI is NOT mocked by this — generation still calls the real model.
 */

export function isMockPlaces(): boolean {
  return Boolean(process.env.MOCK_PLACES) && process.env.MOCK_PLACES !== "0";
}

export function assertMockPlacesDatabase(): void {
  if (!isMockPlaces()) return;
  const url = process.env.DATABASE_URL ?? "";
  if (!/mock/i.test(url)) {
    throw new Error(
      `MOCK_PLACES is on but DATABASE_URL (${url || "unset"}) isn't a mock database — ` +
        "fake places would be cached into your real DB. Use `npm run dev:mock` " +
        "(DATABASE_URL=file:./mock.db) instead.",
    );
  }
}

// FNV-1a — tiny, stable across runs, good enough to spread fake points.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type LatLng = { lat: number; lng: number };

// A deterministic point within maxKm of center.
function offsetFrom(center: LatLng, seed: string, maxKm: number): LatLng {
  const h = hash(seed);
  const angle = ((h & 0xffff) / 0xffff) * 2 * Math.PI;
  const km = ((h >>> 16) / 0xffff) * maxKm;
  const dLat = (km / 111) * Math.cos(angle);
  const dLng = (km / (111 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)))) * Math.sin(angle);
  return { lat: Number((center.lat + dLat).toFixed(6)), lng: Number((center.lng + dLng).toFixed(6)) };
}

// Where a query with no locationBias should land: a known city named in the
// text (city-center lookups, "Café Savoy 布拉格"), else a stable hashed point.
// Only airport cities are known (AIRPORTS) — a city without one (e.g. 京都)
// lands somewhere arbitrary, but always the same place, and everything later
// biased toward it clusters around that point, so distance checks still hold.
function locateByText(text: string): LatLng {
  for (const a of Object.values(AIRPORTS)) {
    if (text.includes(a.cityZh)) return { lat: a.lat, lng: a.lng };
  }
  const h = hash(text);
  return { lat: ((h % 11000) / 100) - 50, lng: (((h >>> 8) % 36000) / 100) - 180 };
}

function fakePlace(seed: string, name: string, at: LatLng, extra: Record<string, unknown> = {}) {
  const id = `mock-${hash(seed).toString(16)}`;
  return {
    id,
    displayName: { text: name },
    formattedAddress: `Mock address — ${name}`,
    location: { latitude: at.lat, longitude: at.lng },
    rating: 3.5 + (hash(seed + ":r") % 15) / 10,
    photos: [{ name: `places/${id}/photos/mock` }],
    ...extra,
  };
}

type Circle = { center: { latitude: number; longitude: number }; radius?: number };

function mockTextSearch(body: {
  textQuery: string;
  locationBias?: { circle?: Circle };
  includedType?: string;
}) {
  const bias = body.locationBias?.circle?.center;
  const center = bias ? { lat: bias.latitude, lng: bias.longitude } : locateByText(body.textQuery);
  // A city lookup (no bias, or restricted to localities) should resolve to
  // the city itself; anything else lands somewhere in town.
  const at = !bias || body.includedType === "locality" ? center : offsetFrom(center, body.textQuery, 3);
  return {
    places: [
      fakePlace(body.textQuery, body.textQuery, at, { priceLevel: "PRICE_LEVEL_MODERATE" }),
    ],
  };
}

function mockNearbySearch(body: {
  includedTypes?: string[];
  maxResultCount?: number;
  locationRestriction?: { circle?: Circle };
}) {
  const circle = body.locationRestriction?.circle;
  if (!circle) return { places: [] };
  const center = { lat: circle.center.latitude, lng: circle.center.longitude };
  const types = body.includedTypes ?? ["point_of_interest"];
  const count = Math.min(body.maxResultCount ?? 10, 20);
  const maxKm = Math.min((circle.radius ?? 3000) / 1000, 3);
  const key = `${types.join(",")}@${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  return {
    places: Array.from({ length: count }, (_, i) => {
      const seed = `${key}#${i}`;
      return fakePlace(seed, `Mock ${types[0]} ${i + 1}`, offsetFrom(center, seed, maxKm), {
        types: [types[0]],
        priceLevel: MOCK_PRICE_LEVELS[hash(seed + ":p") % MOCK_PRICE_LEVELS.length],
      });
    }),
  };
}

type Waypoint = { waypoint: { address?: string; location?: { latLng: { latitude: number; longitude: number } } } };

const MOCK_SPEED_KMH: Record<string, number> = { WALK: 4.5, BICYCLE: 12, TRANSIT: 20, DRIVE: 30 };

function mockRouteMatrix(body: { origins: Waypoint[]; destinations: Waypoint[]; travelMode?: string }) {
  const toPoint = (w: Waypoint): LatLng => {
    const ll = w.waypoint.location?.latLng;
    return ll ? { lat: ll.latitude, lng: ll.longitude } : locateByText(w.waypoint.address ?? "");
  };
  const o = toPoint(body.origins[0]);
  const d = toPoint(body.destinations[0]);
  // Straight-line distance x1.3 as a rough road-network detour factor.
  const meters = Math.round(haversineKm(o.lat, o.lng, d.lat, d.lng) * 1300);
  const speed = MOCK_SPEED_KMH[body.travelMode ?? "DRIVE"] ?? 30;
  const seconds = Math.max(60, Math.round((meters / 1000 / speed) * 3600));
  return [{ originIndex: 0, destinationIndex: 0, distanceMeters: meters, duration: `${seconds}s`, condition: "ROUTE_EXISTS" }];
}

const MOCK_PRICE_LEVELS = ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE"];

function fieldMaskOf(init?: RequestInit): string[] | null {
  const headers = new Headers(init?.headers);
  const mask = headers.get("X-Goog-FieldMask");
  return mask ? mask.split(",").map((f) => f.trim()) : null;
}

// Real Places responses only carry the fields the request's field mask asked
// for (and bill accordingly) — mirror that so a Pro-tier search in mock mode
// comes back without rating/price, same as production.
function applyFieldMask(data: { places: Record<string, unknown>[] }, mask: string[] | null) {
  if (!mask || mask.includes("*")) return data;
  const keep = new Set(mask.filter((f) => f.startsWith("places.")).map((f) => f.slice("places.".length)));
  return { places: data.places.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => keep.has(k)))) };
}

// Fake response for a Google API request, shaped like the real one.
export function mockGoogleResponse(url: string, init?: RequestInit): Response {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  let data: unknown;
  if (url.includes("places:searchText")) data = applyFieldMask(mockTextSearch(body), fieldMaskOf(init));
  else if (url.includes("places:searchNearby")) data = applyFieldMask(mockNearbySearch(body), fieldMaskOf(init));
  else if (url.includes("computeRouteMatrix")) data = mockRouteMatrix(body);
  else return new Response(JSON.stringify({ error: `MOCK_PLACES: unhandled URL ${url}` }), { status: 501 });
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Stand-in image for /api/v1/places/[placeId]/photo in mock mode.
export function mockPhotoSvg(label: string): string {
  const hue = hash(label) % 360;
  const safe = label.replace(/[<>&"]/g, "").slice(0, 24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="hsl(${hue},45%,70%)"/><text x="200" y="160" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#fff">MOCK ${safe}</text></svg>`;
}
