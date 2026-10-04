import { NextResponse } from "next/server";
import { getTwdRates } from "@/lib/exchangeRate";

const TARGET_CURRENCY = "TWD";

// Rates come from the shared getTwdRates() (one upstream request for every
// currency, cached), also used for the budget ranking of restaurants.
export async function GET(request: Request) {
  const base = new URL(request.url).searchParams.get("base");
  if (!base || !/^[A-Z]{3}$/.test(base)) {
    return NextResponse.json({ error: "Invalid base currency" }, { status: 400 });
  }

  const rate = (await getTwdRates())[base];
  if (rate === undefined) {
    return NextResponse.json({ error: "Rate unavailable for this currency" }, { status: 502 });
  }
  return NextResponse.json({ base, target: TARGET_CURRENCY, rate });
}
