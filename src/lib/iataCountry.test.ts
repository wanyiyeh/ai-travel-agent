import { describe, expect, it } from "vitest";
import { IATA_COUNTRY_ZH } from "@/lib/iataCountry";
import { AIRPORTS } from "@/lib/airports";

describe("IATA_COUNTRY_ZH", () => {
  // A new airport added to AIRPORTS but not here shows with no country in the
  // picker — the tables are kept by hand, so this catches the one forgotten.
  it("names the country of every airport a trip can fly to", () => {
    const abroad = Object.entries(AIRPORTS).filter(([, airport]) => !airport.domestic).map(([code]) => code);
    expect(abroad.filter((code) => !IATA_COUNTRY_ZH[code])).toEqual([]);
  });

  it("puts Reykjavík in Iceland", () => {
    expect(AIRPORTS.KEF.cityZh).toBe("雷克雅維克");
    expect(IATA_COUNTRY_ZH.KEF).toBe("冰島");
  });
});
