import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Story: a request URL can land in a log (ours, a proxy's, Google's), so the
// server key travels in a header instead (#212).
describe("GET /api/v1/places/[placeId]/photo", () => {
  it("asks Google for the photo with the key in a header, never in the URL", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "server-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ photoUri: "https://lh3.example/photo" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const placeId = `ChIJ-photo-${Date.now()}`;
    const name = `places/${placeId}/photos/abc`;

    const res = await GET(new Request(`http://test/api/v1/places/${placeId}/photo?name=${encodeURIComponent(name)}&maxWidthPx=100`), {
      params: Promise.resolve({ placeId }),
    });

    expect(res.status).toBe(302);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("server-key");
    expect(url).not.toContain("key=");
    expect(new Headers(init.headers).get("X-Goog-Api-Key")).toBe("server-key");
  });
});
