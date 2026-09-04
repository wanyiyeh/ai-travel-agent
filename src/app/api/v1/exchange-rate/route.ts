import { NextResponse } from "next/server";

const TARGET_CURRENCY = "TWD";

// open.er-api.com's free tier needs no API key and updates once a day —
// plenty for estimating a trip budget (not a live spot rate). Next's fetch
// cache keeps repeat requests for the same base currency cheap.
export async function GET(request: Request) {
  const base = new URL(request.url).searchParams.get("base");
  if (!base || !/^[A-Z]{3}$/.test(base)) {
    return NextResponse.json({ error: "Invalid base currency" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
      next: { revalidate: 21600 },
    });
    if (!res.ok) throw new Error("upstream error");

    const data = (await res.json()) as { result: string; rates?: Record<string, number> };
    const rate = data.result === "success" ? data.rates?.[TARGET_CURRENCY] : undefined;
    if (rate === undefined) {
      return NextResponse.json({ error: "Rate unavailable for this currency" }, { status: 502 });
    }

    return NextResponse.json({ base, target: TARGET_CURRENCY, rate });
  } catch {
    return NextResponse.json({ error: "Failed to fetch exchange rate" }, { status: 502 });
  }
}
