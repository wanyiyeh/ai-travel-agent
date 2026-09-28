import { isMockPlaces, mockGoogleResponse } from "@/lib/mockPlaces";

// Every billable Google Places / Routes HTTP call goes through here, so
// MOCK_PLACES can swap in fake responses at one choke point (see
// lib/mockPlaces.ts). Add any new Google API call site here too, or it will
// silently keep billing in mock mode.
export function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isMockPlaces()) return Promise.resolve(mockGoogleResponse(url, init));
  return fetch(url, init);
}
