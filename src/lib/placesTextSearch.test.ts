import { describe, it, expect, vi, afterEach } from "vitest";
import { searchPlaceText } from "./placesTextSearch";

const PLACE = {
  id: "p1",
  displayName: { text: "Café Savoy" },
  formattedAddress: "Prague",
  location: { latitude: 50.08, longitude: 14.41 },
};

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [PLACE] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchPlaceText in-flight dedupe", () => {
  it("merges concurrent identical requests into one Google call", async () => {
    const fetchMock = stubFetch();
    const bias = { lat: 50.07, lng: 14.43 };
    const [a, b] = await Promise.all([
      searchPlaceText("Café Savoy 布拉格", "key", bias),
      searchPlaceText("Café Savoy 布拉格", "key", bias),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.id).toBe("p1");
    expect(b?.id).toBe("p1");
  });

  it("does not merge requests that differ in bias or type", async () => {
    const fetchMock = stubFetch();
    await Promise.all([
      searchPlaceText("布拉格", "key", { lat: 50.07, lng: 14.43 }),
      searchPlaceText("布拉格", "key", null),
      searchPlaceText("布拉格", "key", null, "locality"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("calls Google again once the earlier request has settled", async () => {
    const fetchMock = stubFetch();
    await searchPlaceText("Café Savoy 布拉格", "key");
    await searchPlaceText("Café Savoy 布拉格", "key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("releases the slot after a failure so the next call retries", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchPlaceText("x", "key")).rejects.toThrow();
    await expect(searchPlaceText("x", "key")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
