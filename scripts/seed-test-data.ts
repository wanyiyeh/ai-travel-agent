/**
 * AI-powered seed script — generates real itineraries across 9 regions via OpenAI.
 * All scenarios use open-jaw routing (different arrival/departure cities).
 * Run: npm run seed
 *
 * Regions covered:
 *   A  亞洲     名古屋→大阪 7天（NGO→KIX）
 *   B  歐洲西歐 巴黎→阿姆斯特丹 14天（CDG→AMS）
 *   C  歐洲東歐 維也納→布拉格 12天（VIE→PRG）
 *   D  歐洲北歐 斯德哥爾摩→哥本哈根 14天（ARN→CPH）
 *   E  英國     倫敦→愛丁堡 12天（LHR→EDI）
 *   F  大洋洲   伯斯→墨爾本 12天（PER→MEL）
 *   G  北美東岸 紐約→邁阿密 15天（JFK→MIA）
 *   H  北美西岸 洛杉磯→舊金山 12天（LAX→SFO）
 *   I  非洲     開普敦→約翰尼斯堡 14天（CPT→JNB）
 *   J  北美太平洋西北 西雅圖來回 10天（SEA→SEA）
 *   K  韓國     首爾來回 5天（ICN→ICN）、釜山來回 5天（PUS→PUS）
 *   L  東南亞   曼谷→普吉島 6天（BKK→HKT）
 *   M  港澳     香港來回 4天（HKG→HKG）
 *   N  中東     杜拜來回 6天（DXB→DXB）
 *   O  日本     東京來回 5天（NRT→NRT）、福岡來回 4天（FUK→FUK）、
 *              沖繩來回 5天（OKA→OKA）、北海道來回 5天（CTS→CTS）
 */

import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import { iataToCity } from "@/lib/iataCity";
import {
  calcDays,
  buildSystemPrompt,
  repairTransitDayDepartureCities,
  tagWaypointCities,
} from "@/lib/itineraryGen";
import { fetchCityRestaurants, fetchCityBreakfastPlaces, buildRestaurantHintsPrompt } from "@/lib/fetchCityRestaurants";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { validateItinerary } from "@/lib/validateItinerary";
// Load .env (Next.js doesn't inject env vars when running plain node)
try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const SEED_MARKER = "[TEST-SEED]";

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── 9 region scenarios（all open-jaw: different arrival/departure cities）─────

interface Scenario {
  continent: string;
  label: string;
  flightInfo: FlightInfo;
  preferences: TripPreferences;
  prompt: string;
}

const SCENARIOS: Scenario[] = [
  {
    continent: "亞洲",
    label: "名古屋→大阪 7天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "NGO",
      returnDepartureCity: "KIX",
      departureDate: "2026-09-01",
      returnDate: "2026-09-08",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["culture", "food"] },
    prompt: "從名古屋出發探索名古屋城、熱田神宮與在地美食文化，搭新幹線移動至大阪體驗道頓堀美食與關西古都氛圍",
  },
  {
    continent: "歐洲西歐",
    label: "巴黎→阿姆斯特丹 14天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "CDG",
      returnDepartureCity: "AMS",
      departureDate: "2026-10-01",
      returnDate: "2026-10-15",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["culture", "shopping"] },
    prompt: "從巴黎出發深度探索法式藝術、時尚與美食，移動至阿姆斯特丹感受荷蘭運河城市魅力與博物館文化",
  },
  {
    continent: "歐洲東歐",
    label: "維也納→布拉格 12天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "VIE",
      returnDepartureCity: "PRG",
      departureDate: "2026-10-10",
      returnDate: "2026-10-22",
    },
    preferences: { pace: "moderate", budget: "budget", interests: ["culture", "food"] },
    prompt: "從維也納的哈布斯堡皇宮與古典音樂文化出發，搭火車移動至布拉格感受波希米亞中世紀古城魅力",
  },
  {
    continent: "歐洲北歐",
    label: "斯德哥爾摩→哥本哈根 14天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "ARN",
      returnDepartureCity: "CPH",
      departureDate: "2026-10-20",
      returnDate: "2026-11-03",
    },
    preferences: { pace: "relaxed", budget: "luxury", interests: ["nature", "culture"] },
    prompt: "從斯德哥爾摩深度探索北歐設計美學與皇宮群島，移動至哥本哈根感受丹麥的幸福生活哲學與新北歐料理",
  },
  {
    continent: "英國",
    label: "倫敦→愛丁堡 12天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "LHR",
      returnDepartureCity: "EDI",
      departureDate: "2026-11-10",
      returnDate: "2026-11-22",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["culture", "food"] },
    prompt: "從倫敦的大英博物館與皇室文化出發，搭高鐵北上蘇格蘭，在愛丁堡深度感受古堡、威士忌與高地風情",
  },
  {
    continent: "大洋洲",
    label: "伯斯→墨爾本 12天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "PER",
      returnDepartureCity: "MEL",
      departureDate: "2026-11-01",
      returnDate: "2026-11-13",
    },
    preferences: { pace: "relaxed", budget: "moderate", interests: ["nature", "food"] },
    prompt: "從伯斯出發探索費里曼圖港口小鎮與羅特尼斯島藍綠海灣，搭機移動至墨爾本，體驗大洋路十二使徒岩壯麗海岸景色、菲利普島企鵝歸巢，最後深度感受墨爾本的咖啡文化與街頭藝術巷弄",
  },
  {
    continent: "北美東岸",
    label: "紐約→邁阿密 15天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "JFK",
      returnDepartureCity: "MIA",
      departureDate: "2026-12-01",
      returnDate: "2026-12-16",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["culture", "food", "shopping"] },
    prompt: "從紐約探索世界頂尖博物館、百老匯與多元街區，沿東岸南下華盛頓、薩凡納，最後至邁阿密享受陽光海灘與拉丁文化",
  },
  {
    continent: "北美西岸",
    label: "洛杉磯→舊金山 12天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "LAX",
      returnDepartureCity: "SFO",
      departureDate: "2027-01-05",
      returnDate: "2027-01-17",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["culture", "nature", "food"] },
    prompt: "從洛杉磯的好萊塢與海灘出發，途經聖巴巴拉、大蘇爾沿太平洋海岸公路北上，在舊金山感受科技與藝術交融的城市氣息",
  },
  {
    continent: "非洲",
    label: "開普敦→約翰尼斯堡 14天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "CPT",
      returnDepartureCity: "JNB",
      departureDate: "2027-02-01",
      returnDate: "2027-02-15",
    },
    preferences: { pace: "relaxed", budget: "moderate", interests: ["nature", "adventure"] },
    prompt: "從開普敦的桌山、好望角與酒莊出發，深度探索南非壯麗自然景觀，移動至約翰尼斯堡感受非洲都市脈動與近郊野生動物園",
  },
  {
    continent: "北美太平洋西北",
    label: "西雅圖來回 10天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "SEA",
      returnDepartureCity: "SEA",
      departureDate: "2027-03-01",
      returnDate: "2027-03-11",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["nature", "food", "culture"] },
    prompt: "以西雅圖為據點，探索派克市場、太空針塔與都會咖啡文化，安排一日雷尼爾山國家公園健行，感受太平洋西北的自然與城市交融氛圍",
  },
  {
    continent: "韓國",
    label: "首爾 5天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "ICN",
      returnDepartureCity: "ICN",
      departureDate: "2026-08-10",
      returnDate: "2026-08-15",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["food", "shopping", "culture"] },
    prompt: "深度探索首爾的明洞、景福宮、北村韓屋村，感受韓式街頭美食、購物與傳統文化交融的城市魅力",
  },
  {
    continent: "韓國",
    label: "釜山 5天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "PUS",
      returnDepartureCity: "PUS",
      departureDate: "2026-08-20",
      returnDate: "2026-08-25",
    },
    preferences: { pace: "relaxed", budget: "moderate", interests: ["food", "nature", "culture"] },
    prompt: "以釜山為據點，探索海雲台與廣安里海灘、甘川洞文化村，感受港都海鮮美食與悠閒海岸風情",
  },
  {
    continent: "東南亞",
    label: "曼谷→普吉島 6天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "BKK",
      returnDepartureCity: "HKT",
      departureDate: "2026-08-20",
      returnDate: "2026-08-26",
    },
    preferences: { pace: "relaxed", budget: "budget", interests: ["food", "nature"] },
    prompt: "從曼谷探索水上市場美食與臥佛寺文化，飛往普吉島享受安達曼海島度假與浮潛時光",
  },
  {
    continent: "港澳",
    label: "香港 4天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "HKG",
      returnDepartureCity: "HKG",
      departureDate: "2026-09-15",
      returnDate: "2026-09-19",
    },
    preferences: { pace: "intensive", budget: "moderate", interests: ["food", "shopping"] },
    prompt: "快閃香港感受中西合璧街景，深度茶餐廳與米其林美食巡禮，夜遊維多利亞港感受璀璨夜景",
  },
  {
    continent: "中東",
    label: "杜拜 6天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "DXB",
      returnDepartureCity: "DXB",
      departureDate: "2026-09-25",
      returnDate: "2026-10-01",
    },
    preferences: { pace: "moderate", budget: "luxury", interests: ["adventure", "shopping"] },
    prompt: "杜拜沙漠越野探險與哈里發塔天際線，深度感受奢華購物中心與阿拉伯傳統文化市集",
  },
  {
    continent: "日本",
    label: "東京 5天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "NRT",
      returnDepartureCity: "NRT",
      departureDate: "2026-07-10",
      returnDate: "2026-07-15",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["culture", "food", "shopping"] },
    prompt: "深度探索東京的淺草寺、澀谷與原宿潮流文化，感受都會美食巡禮與傳統現代交融的城市魅力",
  },
  {
    continent: "日本",
    label: "福岡 4天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "FUK",
      returnDepartureCity: "FUK",
      departureDate: "2026-07-20",
      returnDate: "2026-07-24",
    },
    preferences: { pace: "relaxed", budget: "budget", interests: ["food", "culture"] },
    prompt: "探索福岡博多老城與太宰府天滿宮，感受屋台美食文化與九州小城悠閒步調",
  },
  {
    continent: "日本",
    label: "沖繩 5天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "OKA",
      returnDepartureCity: "OKA",
      departureDate: "2026-07-28",
      returnDate: "2026-08-02",
    },
    preferences: { pace: "relaxed", budget: "moderate", interests: ["nature", "food"] },
    prompt: "探索沖繩美麗海水族館、國際通與慶良間諸島海島風情，感受琉球文化與湛藍海洋度假氛圍",
  },
  {
    continent: "日本",
    label: "北海道 5天",
    flightInfo: {
      departureCity: "TPE",
      arrivalCity: "CTS",
      returnDepartureCity: "CTS",
      departureDate: "2026-08-05",
      returnDate: "2026-08-10",
    },
    preferences: { pace: "moderate", budget: "moderate", interests: ["nature", "food", "culture"] },
    prompt: "探索札幌時計台、小樽運河與富良野花海，感受北國自然景觀與海鮮美食文化",
  },
];

// ─── generation ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repairMissingAccommodation(days: any[]): any[] {
  const lastDayNum = days.length;
  return days.map((day, i) => {
    if (day.day === lastDayNum || day.isTransitDay || day.accommodation) return day;
    const source = days.slice(0, i).reverse().find((d) => d.accommodation);
    if (!source) return day;
    console.warn(`    [Accommodation Repair] 第${day.day}天缺少住宿，沿用第${source.day}天：${source.accommodation.name}`);
    return { ...day, accommodation: { ...source.accommodation } };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateItinerary(scenario: Scenario, retries = 3): Promise<any> {
  const { flightInfo, preferences, prompt } = scenario;
  const days = calcDays(flightInfo.departureDate, flightInfo.returnDate);
  const arrivalCityName = iataToCity(flightInfo.arrivalCity);
  const returnCityName = iataToCity(flightInfo.returnDepartureCity);

  // Fetch real restaurants from Google Places to inject into prompt
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  let restaurantHintsPrompt = "";
  if (googleApiKey) {
    const iataCodes = [...new Set([flightInfo.arrivalCity, flightInfo.returnDepartureCity])];
    const cityEntries = await Promise.all(
      iataCodes.map(async (code) => {
        const [breakfastPlaces, mainMealPlaces] = await Promise.all([
          fetchCityBreakfastPlaces(code, googleApiKey),
          fetchCityRestaurants(code, googleApiKey),
        ]);
        return { cityNameZh: iataToCity(code), iataCode: code, breakfastPlaces, mainMealPlaces };
      })
    );
    restaurantHintsPrompt = buildRestaurantHintsPrompt(cityEntries);
    for (const { cityNameZh, breakfastPlaces, mainMealPlaces } of cityEntries) {
      if (breakfastPlaces.length > 0) {
        console.log(`    📍 ${cityNameZh}：取得 ${breakfastPlaces.length} 家真實早餐地點`);
      }
      if (mainMealPlaces.length > 0) {
        console.log(`    📍 ${cityNameZh}：取得 ${mainMealPlaces.length} 家真實餐廳`);
      }
    }
  }

  const systemPrompt = buildSystemPrompt(flightInfo, preferences, days, restaurantHintsPrompt);
  const isMultiCity = arrivalCityName !== returnCityName;
  const destinationDesc = isMultiCity ? `${arrivalCityName} → ${returnCityName}` : arrivalCityName;
  const userContent = prompt
    ? `請規劃行程，風格描述：${prompt}`
    : `請規劃 ${destinationDesc} ${days} 天行程`;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 16000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("OpenAI 回傳空內容");

      const parsed = JSON.parse(content);
      if (!parsed.days || !Array.isArray(parsed.days) || parsed.days.length === 0) {
        throw new Error(`回傳格式錯誤：days 陣列為空或不存在`);
      }
      if (parsed.days.length !== days) {
        throw new Error(`天數不符：期望 ${days} 天，實際 ${parsed.days.length} 天`);
      }

      parsed.days = tagWaypointCities(parsed.days, arrivalCityName);
      if (isMultiCity) {
        parsed.days = repairTransitDayDepartureCities(parsed.days);
      }
      parsed.days = repairMissingAccommodation(parsed.days);

      const validationResult = validateItinerary(parsed, flightInfo, arrivalCityName, returnCityName);
      if (validationResult.issues.length > 0) {
        console.warn(`    ⚠ 行程驗證警告（${validationResult.issues.length} 項）：`);
        for (const issue of validationResult.issues) console.warn(`      [${issue.code}] ${issue.message}`);
        // ACCOMMODATION_MISSING 已由 repairMissingAccommodation 處理，不觸發 retry
        // RESTAURANT_OVERUSED 已由 Google Places 注入改善，偏遠地區（如 Kruger）有限餐廳可接受
        const RETRY_CODES = new Set([
          "DAY_COUNT_MISMATCH",
          "DAY_NUMBER_SEQUENCE",
          "DAY_TOO_FEW_STOPS",
          "TRANSIT_DAY_MISSING",
          "TRANSIT_DAY_TOO_LATE",
          "TRANSIT_DAY_INVALID_POSITION",
          "TRANSIT_DAY_NO_TRANSITTO",
          "TRANSIT_DAY_UNEXPECTED",
          "FINAL_CITY_MISMATCH",
        ]);
        const retryIssues = validationResult.issues.filter(i => {
          if (!RETRY_CODES.has(i.code)) return false;
          // 最後一天（回程日）景點少是正常的，不觸發 retry
          if (i.code === "DAY_TOO_FEW_STOPS" && i.day === days) return false;
          return true;
        });
        if (retryIssues.length > 0) {
          throw new Error(`行程驗證失敗：${retryIssues.map(i => `[${i.code}] ${i.message}`).join("；")}`);
        }
      }

      return parsed;
    } catch (err) {
      if (attempt > retries) throw err;
      console.warn(`    ⚠ 第 ${attempt} 次嘗試失敗（${(err as Error).message}），重試中...`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addIds(itinerary: any): any {
  return {
    ...itinerary,
    days: itinerary.days.map((day: any) => ({
      ...day,
      id: randomUUID(),
      stops: (day.stops ?? []).map((stop: any, idx: number) => ({
        ...stop,
        id: randomUUID(),
        orderIndex: idx,
      })),
    })),
  };
}

// ─── Google Places enrichment ─────────────────────────────────────────────────

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

interface PlaceEnrichment {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  rating?: number;
}

async function searchPlaceForSeed(query: string, apiKey: string): Promise<PlaceEnrichment | null> {
  try {
    const res = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.rating",
        ].join(","),
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });

    if (!res.ok) {
      console.warn(`    [Places] HTTP ${res.status} for "${query}"`);
      return null;
    }

    const data = await res.json();
    const place = data.places?.[0];
    if (!place) return null;

    return {
      placeId: place.id,
      name: place.displayName?.text ?? query,
      lat: place.location.latitude,
      lng: place.location.longitude,
      address: place.formattedAddress,
      rating: place.rating ?? undefined,
    };
  } catch (err) {
    console.warn(`    [Places] 查詢失敗 "${query}":`, err);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichMeals(meals: any, city: string, apiKey: string): Promise<{ meals: any; enriched: number; cacheHits: number; skipped: number }> {
  let enriched = 0;
  let cacheHits = 0;
  let skipped = 0;
  const result = { ...meals };

  for (const mealType of ["breakfast", "lunch", "dinner"]) {
    const meal = meals[mealType];
    if (!meal) continue;

    const query = city ? `${meal.name} ${city}` : (meal.name as string);

    const cached = await lookupByQuery(query);
    if (cached && cached.lat != null && cached.lng != null) {
      result[mealType] = { ...meal, placeId: cached.placeId, lat: cached.lat, lng: cached.lng, address: cached.address, rating: cached.rating };
      cacheHits++;
      continue;
    }

    const placeData = await searchPlaceForSeed(query, apiKey);
    if (placeData) {
      await upsertPlace(query, { placeId: placeData.placeId, name: placeData.name, address: placeData.address, lat: placeData.lat, lng: placeData.lng, rating: placeData.rating });
      result[mealType] = { ...meal, placeId: placeData.placeId, lat: placeData.lat, lng: placeData.lng, address: placeData.address, rating: placeData.rating ?? null };
      enriched++;
    } else {
      skipped++;
    }

    await new Promise(r => setTimeout(r, 150));
  }

  return { meals: result, enriched, cacheHits, skipped };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichDaysWithPlaces(days: any[], apiKey: string): Promise<any[]> {
  let enriched = 0;
  let cacheHits = 0;
  let skipped = 0;

  const result = [];
  for (const day of days) {
    const city: string = day.waypointCity || day.transitTo || "";
    const enrichedStops = [];

    for (const stop of (day.stops ?? [])) {
      // 交通接駁類 stop（搭乘某交通工具前往某地）不是真實景點，跳過
      const isTransportLeg =
        (stop.name as string).includes("搭乘") && (stop.name as string).includes("前往");

      if (isTransportLeg) {
        enrichedStops.push(stop);
        skipped++;
        continue;
      }

      const query = city ? `${stop.name} ${city}` : (stop.name as string);

      // Check DB cache first — skip API call if already known
      const cached = await lookupByQuery(query);
      if (cached && cached.lat != null && cached.lng != null) {
        enrichedStops.push({ ...stop, placeId: cached.placeId, lat: cached.lat, lng: cached.lng, address: cached.address, rating: cached.rating });
        cacheHits++;
        continue;
      }

      const placeData = await searchPlaceForSeed(query, apiKey);

      if (placeData) {
        await upsertPlace(query, { placeId: placeData.placeId, name: placeData.name, address: placeData.address, lat: placeData.lat, lng: placeData.lng, rating: placeData.rating });
        enrichedStops.push({ ...stop, placeId: placeData.placeId, lat: placeData.lat, lng: placeData.lng, address: placeData.address, rating: placeData.rating ?? null });
        enriched++;
      } else {
        enrichedStops.push(stop);
        skipped++;
      }

      // 避免觸發 Places API rate limit
      await new Promise(r => setTimeout(r, 150));
    }

    let enrichedDay: any = { ...day, stops: enrichedStops };
    if (day.meals) {
      const mealResult = await enrichMeals(day.meals, city, apiKey);
      enrichedDay = { ...enrichedDay, meals: mealResult.meals };
      enriched += mealResult.enriched;
      cacheHits += mealResult.cacheHits;
      skipped += mealResult.skipped;
    }

    result.push(enrichedDay);
  }

  console.log(`    📍 Places enrichment：${enriched} API，${cacheHits} cache hit，${skipped} 跳過`);
  return result;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY — 請確認 .env 已設定");
  }

  const args = process.argv.slice(2);
  const noEnrich = args.includes("--no-enrich");
  const filter = args.find(a => !a.startsWith("--"))?.trim().toLowerCase();
  const scenarios = filter
    ? SCENARIOS.filter(s =>
        s.continent.toLowerCase().includes(filter) ||
        s.label.toLowerCase().includes(filter),
      )
    : SCENARIOS;

  if (filter && scenarios.length === 0) {
    console.error(`❌ 找不到符合「${filter}」的 scenario`);
    console.error(`可用選項：${SCENARIOS.map(s => s.continent).join("、")}`);
    process.exit(1);
  }

  if (filter) {
    console.log(`🔍 篩選：「${filter}」→ 找到 ${scenarios.length} 筆\n`);
  }

  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: { id: DEMO_USER_ID, email: "demo@ai-travel-agent.dev", name: "Demo User" },
  });

  const existing = await prisma.itinerary.findMany({
    where: { userId: DEMO_USER_ID },
    select: { id: true, title: true },
  });
  const targetLabels = new Set(scenarios.map(s => `[${s.continent}]`));
  const toDelete = existing.filter(it =>
    it.title.startsWith(SEED_MARKER) &&
    (!filter || [...targetLabels].some(label => it.title.includes(label))),
  );
  if (toDelete.length > 0) {
    await prisma.itinerary.deleteMany({ where: { id: { in: toDelete.map(it => it.id) } } });
    console.log(`🗑  清除 ${toDelete.length} 筆舊 seed 資料\n`);
  }

  const results: { continent: string; label: string; id: string }[] = [];

  for (const scenario of scenarios) {
    const days = calcDays(scenario.flightInfo.departureDate, scenario.flightInfo.returnDate);
    console.log(`🌍 [${scenario.continent}] ${scenario.label}（${days}天）...`);

    try {
      const itinerary = await generateItinerary(scenario);
      const withIds = addIds(itinerary);
      const arrivalCityName = iataToCity(scenario.flightInfo.arrivalCity);
      const taggedDays = tagWaypointCities(withIds.days, arrivalCityName);

      const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
      const finalDays = (googleApiKey && !noEnrich)
        ? await enrichDaysWithPlaces(taggedDays, googleApiKey)
        : taggedDays;
      if (noEnrich) console.log("    ⏭  Places enrichment 已跳過（--no-enrich）");

      const saved = await prisma.itinerary.create({
        data: {
          userId: DEMO_USER_ID,
          title: `${SEED_MARKER} [${scenario.continent}] ${itinerary.title ?? scenario.label}`,
          days: JSON.stringify(finalDays),
          config: JSON.stringify({
            generatedWith: scenario.prompt,
            totalDays: days,
            createdAt: new Date().toISOString(),
            isStreamed: false,
            flightInfo: scenario.flightInfo,
            preferences: scenario.preferences,
            currency: itinerary.currency ?? null,
            continent: scenario.continent,
          }),
        },
      });

      results.push({ continent: scenario.continent, label: scenario.label, id: saved.id });
      console.log(`  ✅ 儲存成功 → http://localhost:3000/view/${saved.id}\n`);
    } catch (err) {
      console.error(`  ❌ 生成失敗：${(err as Error).message}\n`);
    }
  }

  console.log("📋 Seed 結果總覽：");
  console.log("─".repeat(60));
  for (const r of results) {
    console.log(`  ${r.continent.padEnd(5)} ${r.label.padEnd(22)} ${r.id}`);
  }
  console.log(`\n共 ${results.length}/${scenarios.length} 筆成功`);
  console.log("前往 http://localhost:3000/itineraries 查看所有行程");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
