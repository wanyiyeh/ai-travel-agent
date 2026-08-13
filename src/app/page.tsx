"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStreamingGenerate } from "@/hooks/useStreamingGenerate";
import StreamingPreview from "@/components/StreamingPreview";
import type { TripPreferences, FlightInfo } from "@/lib/schemas";

const PACE_OPTIONS: { value: TripPreferences["pace"]; label: string; desc: string }[] = [
  { value: "relaxed", label: "悠閒", desc: "每天 ≤3 個景點" },
  { value: "moderate", label: "適中", desc: "每天 3-4 個景點" },
  { value: "intensive", label: "緊湊", desc: "每天 5+ 個景點" },
];

const BUDGET_OPTIONS: { value: TripPreferences["budget"]; label: string; desc: string }[] = [
  { value: "budget", label: "經濟實惠", desc: "平價為主" },
  { value: "moderate", label: "中等消費", desc: "一般觀光" },
  { value: "luxury", label: "高端奢華", desc: "頂級體驗" },
];

const INTEREST_OPTIONS: { value: NonNullable<TripPreferences["interests"]>[number]; label: string }[] = [
  { value: "food", label: "美食" },
  { value: "culture", label: "文化歷史" },
  { value: "nature", label: "自然景觀" },
  { value: "shopping", label: "購物" },
  { value: "adventure", label: "冒險戶外" },
];

const IATA_CITY: Record<string, string> = {
  TPE: "台北", KHH: "高雄", RMQ: "台中",
  VIE: "維也納", PRG: "布拉格", BUD: "布達佩斯",
  BTS: "布拉提斯拉瓦", LJU: "盧布亞納", ZAG: "薩格勒布",
  DBV: "杜布羅夫尼克", SJJ: "薩拉熱窩", BEG: "貝爾格勒",
  FRA: "法蘭克福", MUC: "慕尼黑", BER: "柏林", HAM: "漢堡",
  ZRH: "蘇黎世", GVA: "日內瓦", BRU: "布魯塞爾",
  CDG: "巴黎", LYS: "里昂", NCE: "尼斯",
  LHR: "倫敦", EDI: "愛丁堡", MAN: "曼徹斯特", DUB: "都柏林",
  AMS: "阿姆斯特丹", CPH: "哥本哈根", OSL: "奧斯陸", ARN: "斯德哥爾摩",
  HEL: "赫爾辛基", WAW: "華沙", SOF: "索非亞", OTP: "布加勒斯特",
  ATH: "雅典", IST: "伊斯坦堡",
  FCO: "羅馬", MXP: "米蘭", VCE: "威尼斯", NAP: "那不勒斯",
  BCN: "巴塞隆納", MAD: "馬德里", LIS: "里斯本",
  NRT: "東京", HND: "東京", KIX: "大阪", NGO: "名古屋", ICN: "首爾",
  BKK: "曼谷", SIN: "新加坡", HKG: "香港", KUL: "吉隆坡",
  DPS: "峇里島", SGN: "胡志明市", HAN: "河內", REP: "暹粒",
  SYD: "雪梨", MEL: "墨爾本", AKL: "奧克蘭",
  JFK: "紐約", LAX: "洛杉磯", SFO: "舊金山", MIA: "邁阿密",
  YYZ: "多倫多", DXB: "杜拜", DOH: "杜哈",
  CAI: "開羅", CMN: "卡薩布蘭加", JNB: "約翰尼斯堡", CPT: "開普敦",
};

type NearbySuggestion = { name: string; country: string; transitTime: string; mode: string };

const ROUTE_NEARBY: Record<string, NearbySuggestion[]> = {
  "VIE-PRG": [
    { name: "布達佩斯", country: "匈牙利", transitTime: "2.5小時", mode: "火車" },
    { name: "布拉提斯拉瓦", country: "斯洛伐克", transitTime: "1小時", mode: "火車" },
    { name: "薩爾茲堡", country: "奧地利", transitTime: "2.5小時", mode: "火車" },
  ],
  "PRG-VIE": [
    { name: "布達佩斯", country: "匈牙利", transitTime: "2.5小時", mode: "火車" },
    { name: "布拉提斯拉瓦", country: "斯洛伐克", transitTime: "1小時", mode: "火車" },
  ],
  "VIE-BUD": [{ name: "布拉提斯拉瓦", country: "斯洛伐克", transitTime: "1小時", mode: "火車" }],
  "BUD-PRG": [
    { name: "布拉提斯拉瓦", country: "斯洛伐克", transitTime: "2小時", mode: "火車" },
    { name: "維也納", country: "奧地利", transitTime: "2.5小時", mode: "火車" },
  ],
  "CDG-BCN": [
    { name: "里昂", country: "法國", transitTime: "2小時", mode: "TGV高鐵" },
    { name: "馬賽", country: "法國", transitTime: "3小時", mode: "TGV高鐵" },
  ],
  "CDG-MAD": [
    { name: "波爾多", country: "法國", transitTime: "2小時", mode: "TGV高鐵" },
    { name: "塞維利亞", country: "西班牙", transitTime: "2小時", mode: "AVE高鐵" },
  ],
  "LIS-MAD": [
    { name: "波爾圖", country: "葡萄牙", transitTime: "3小時", mode: "火車" },
    { name: "塞維利亞", country: "西班牙", transitTime: "2.5小時", mode: "巴士" },
  ],
  "CPH-ARN": [
    { name: "哥特堡", country: "瑞典", transitTime: "3小時", mode: "火車" },
    { name: "馬爾默", country: "瑞典", transitTime: "35分鐘", mode: "火車" },
  ],
  "NRT-KIX": [
    { name: "名古屋", country: "日本", transitTime: "1.5小時", mode: "新幹線" },
    { name: "京都", country: "日本", transitTime: "2.5小時", mode: "新幹線" },
    { name: "奈良", country: "日本", transitTime: "45分鐘", mode: "近鐵" },
  ],
  "KIX-NRT": [
    { name: "京都", country: "日本", transitTime: "15分鐘", mode: "新幹線" },
    { name: "名古屋", country: "日本", transitTime: "1小時", mode: "新幹線" },
    { name: "廣島", country: "日本", transitTime: "1.5小時", mode: "新幹線" },
  ],
  "NGO-KIX": [
    { name: "京都", country: "日本", transitTime: "35分鐘", mode: "新幹線" },
    { name: "奈良", country: "日本", transitTime: "1小時", mode: "近鐵" },
    { name: "神戶", country: "日本", transitTime: "1.5小時", mode: "新幹線" },
  ],
  "KIX-NGO": [
    { name: "京都", country: "日本", transitTime: "15分鐘", mode: "新幹線" },
    { name: "奈良", country: "日本", transitTime: "45分鐘", mode: "近鐵" },
    { name: "廣島", country: "日本", transitTime: "1.5小時", mode: "新幹線" },
  ],
  "BKK-SGN": [
    { name: "金邊", country: "柬埔寨", transitTime: "1小時", mode: "飛機" },
    { name: "暹粒", country: "柬埔寨", transitTime: "1小時", mode: "飛機" },
    { name: "河內", country: "越南", transitTime: "2小時", mode: "飛機" },
  ],
  "SIN-BKK": [
    { name: "吉隆坡", country: "馬來西亞", transitTime: "45分鐘", mode: "飛機" },
    { name: "檳城", country: "馬來西亞", transitTime: "1小時", mode: "飛機" },
  ],
  "DBV-BEG": [
    { name: "科托爾", country: "蒙特內哥羅", transitTime: "2小時", mode: "巴士" },
    { name: "薩拉熱窩", country: "波士尼亞", transitTime: "5小時", mode: "巴士" },
  ],
  "FCO-ATH": [
    { name: "那不勒斯", country: "義大利", transitTime: "1.5小時", mode: "火車" },
    { name: "布林迪西", country: "義大利", transitTime: "3.5小時", mode: "火車" },
  ],
};

function getNearby(dep: string, arr: string): NearbySuggestion[] | null {
  return ROUTE_NEARBY[`${dep}-${arr}`] || ROUTE_NEARBY[`${arr}-${dep}`] || null;
}


function calcDays(departureDate: string, returnDate: string): number {
  if (!departureDate || !returnDate) return 0;
  const dep = new Date(departureDate);
  const ret = new Date(returnDate);
  return Math.max(0, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function Home() {
  const router = useRouter();

  // 機票資訊（IATA 機場代號）
  const [departureCity, setDepartureCity] = useState("");
  const [arrivalCity, setArrivalCity] = useState("");
  const [returnDepartureCity, setReturnDepartureCity] = useState("");
  const [returnArrivalCity, setReturnArrivalCity] = useState("");

  const toIATA = (val: string) => val.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [returnDepartureTime, setReturnDepartureTime] = useState("");

  // 行程描述與偏好
  const [prompt, setPrompt] = useState("");
  const [pace, setPace] = useState<TripPreferences["pace"]>(undefined);
  const [budget, setBudget] = useState<TripPreferences["budget"]>(undefined);
  const [interests, setInterests] = useState<NonNullable<TripPreferences["interests"]>>([]);
  const [travelers, setTravelers] = useState(2);
  const [selectedWaypoints, setSelectedWaypoints] = useState<string[]>([]);

  const { state, partialData, id, error, generate, reset, isLoading } =
    useStreamingGenerate();

  const days = calcDays(departureDate, returnDate);

  function toggleInterest(val: NonNullable<TripPreferences["interests"]>[number]) {
    setInterests((prev) =>
      prev.includes(val) ? prev.filter((i) => i !== val) : [...prev, val]
    );
  }

  function toggleWaypoint(name: string) {
    setSelectedWaypoints((prev) =>
      prev.includes(name) ? prev.filter((w) => w !== name) : [...prev, name]
    );
  }

  useEffect(() => {
    if (state === "complete" && id) {
      router.push(`/view/${id}`);
    }
  }, [state, id, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const flightInfo: FlightInfo = {
      departureCity,
      arrivalCity,
      returnDepartureCity: returnDepartureCity || arrivalCity,
      returnArrivalCity: returnArrivalCity || undefined,
      departureDate,
      returnDate,
      arrivalTime: arrivalTime || undefined,
      returnDepartureTime: returnDepartureTime || undefined,
    };

    const preferences: TripPreferences = {
      pace,
      budget,
      interests: interests.length ? interests : undefined,
      travelers,
    };

    const waypointsNote = selectedWaypoints.length > 0
      ? `中途停留城市：${selectedWaypoints.join("、")}`
      : "";
    const fullPrompt = [prompt, waypointsNote].filter(Boolean).join("。");

    await generate(fullPrompt, flightInfo, preferences);
  }

  const isStreaming = state === "streaming" || state === "connecting";
  const isFormValid =
    departureCity.length === 3 &&
    arrivalCity.length === 3 &&
    departureDate &&
    returnDate &&
    days > 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              AI Travel Agent
            </h1>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              輸入機票資訊，讓 AI 幫你規劃行程與住宿
            </p>
          </div>
          <Link
            href="/itineraries"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
          >
            已儲存的行程
          </Link>
        </div>

        {/* Form – hidden while streaming */}
        {!isStreaming && state !== "complete" && (
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* 機票資訊 */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                機票資訊
              </h2>

              {/* 去程 */}
              <div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">去程</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label
                      htmlFor="departureCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      出發機場代號
                    </label>
                    <input
                      id="departureCity"
                      type="text"
                      value={departureCity}
                      onChange={(e) => setDepartureCity(toIATA(e.target.value))}
                      placeholder="TPE"
                      maxLength={3}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="arrivalCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      抵達機場代號
                    </label>
                    <input
                      id="arrivalCity"
                      type="text"
                      value={arrivalCity}
                      onChange={(e) => {
                        const code = toIATA(e.target.value);
                        setArrivalCity(code);
                        if (!returnDepartureCity) setReturnDepartureCity(code);
                      }}
                      placeholder="SYD"
                      maxLength={3}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="departureDate"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      去程日期
                    </label>
                    <input
                      id="departureDate"
                      type="date"
                      value={departureDate}
                      onChange={(e) => setDepartureDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="arrivalTime"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      航班抵達時間
                      <span className="font-normal text-zinc-400 ml-1">（選填）</span>
                    </label>
                    <input
                      id="arrivalTime"
                      type="time"
                      value={arrivalTime}
                      onChange={(e) => setArrivalTime(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 回程 */}
              <div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">回程</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label
                      htmlFor="returnDepartureCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      出發機場代號
                      <span className="font-normal text-zinc-400 ml-1">（若與抵達地不同）</span>
                    </label>
                    <input
                      id="returnDepartureCity"
                      type="text"
                      value={returnDepartureCity}
                      onChange={(e) => setReturnDepartureCity(toIATA(e.target.value))}
                      placeholder={arrivalCity || "MEL"}
                      maxLength={3}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="returnArrivalCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      抵達機場代號
                    </label>
                    <input
                      id="returnArrivalCity"
                      type="text"
                      value={returnArrivalCity}
                      onChange={(e) => setReturnArrivalCity(toIATA(e.target.value))}
                      placeholder={departureCity || "TPE"}
                      maxLength={3}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="returnDate"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      回程日期
                    </label>
                    <input
                      id="returnDate"
                      type="date"
                      value={returnDate}
                      min={departureDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="returnDepartureTime"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      航班出發時間
                      <span className="font-normal text-zinc-400 ml-1">（選填）</span>
                    </label>
                    <input
                      id="returnDepartureTime"
                      type="time"
                      value={returnDepartureTime}
                      onChange={(e) => setReturnDepartureTime(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                </div>
              </div>

              {days > 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  共 <span className="font-semibold text-zinc-900 dark:text-zinc-50">{days} 天</span> 行程
                </p>
              )}
            </div>

            {/* Route Inspiration – 途中探索 */}
            {departureCity.length === 3 && arrivalCity.length === 3 && departureCity !== arrivalCity && (() => {
              const nearby = getNearby(departureCity, arrivalCity);
              if (!nearby) return null;
              return (
                <div className="rounded-xl border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/20 overflow-hidden">
                  <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 dark:bg-violet-500 shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-violet-900 dark:text-violet-100">途中探索</h3>
                      <p className="text-xs text-violet-600 dark:text-violet-400">
                        {IATA_CITY[departureCity] || departureCity} → {IATA_CITY[arrivalCity] || arrivalCity} 途中，85% 旅者也會造訪：
                      </p>
                    </div>
                  </div>
                  <div className="px-4 pb-4 space-y-2">
                    {nearby.map((s) => (
                      <div
                        key={s.name}
                        className="flex items-center justify-between rounded-lg bg-white dark:bg-zinc-900 border border-violet-100 dark:border-violet-900/50 px-3 py-2 gap-3"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{s.name}</span>
                          <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{s.country}</span>
                          <span className="ml-2 text-xs text-violet-500 dark:text-violet-400">
                            · {s.mode} {s.transitTime}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleWaypoint(s.name)}
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                            selectedWaypoints.includes(s.name)
                              ? "bg-violet-600 dark:bg-violet-500 text-white"
                              : "border border-violet-200 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                          }`}
                        >
                          {selectedWaypoints.includes(s.name) ? "✓ 已選" : "+ 加入"}
                        </button>
                      </div>
                    ))}
                    {selectedWaypoints.length > 0 && (
                      <p className="text-xs text-violet-600 dark:text-violet-400 pt-1">
                        已選擇中途停留：{selectedWaypoints.join("、")}（AI 將規劃此路線）
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 旅遊描述 */}
            <div>
              <label
                htmlFor="prompt"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
              >
                旅遊風格描述 <span className="font-normal text-zinc-400">（選填）</span>
              </label>
              <input
                id="prompt"
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例：以文化美食為主、想體驗當地生活"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            {/* 步調 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                步調與節奏
              </label>
              <div className="flex gap-2">
                {PACE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPace(pace === opt.value ? undefined : opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      pace === opt.value
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs opacity-60">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 預算 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                預算區間
              </label>
              <div className="flex gap-2">
                {BUDGET_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBudget(budget === opt.value ? undefined : opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      budget === opt.value
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs opacity-60">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 特殊偏好 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                特殊偏好 <span className="font-normal text-zinc-400">（可複選）</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {INTEREST_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleInterest(opt.value)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      interests.includes(opt.value)
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 旅行人數 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                旅行人數
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTravelers((n) => Math.max(1, n - 1))}
                  className="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center font-medium"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {travelers}
                </span>
                <button
                  type="button"
                  onClick={() => setTravelers((n) => Math.min(20, n + 1))}
                  className="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center font-medium"
                >
                  +
                </button>
                <span className="text-xs text-zinc-400">人</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !isFormValid}
              className="w-full rounded-lg bg-zinc-900 dark:bg-zinc-50 px-4 py-3 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              生成行程
            </button>
          </form>
        )}

        {/* Error state */}
        {state === "error" && error && (
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
            <button
              onClick={reset}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
            >
              重新嘗試
            </button>
          </div>
        )}

        {/* Streaming preview */}
        {isStreaming && (
          <div className="mt-8">
            <StreamingPreview partialData={partialData} days={days} />
          </div>
        )}

        {/* Brief completion message before redirect */}
        {state === "complete" && (
          <div className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            行程已生成，正在跳轉...
          </div>
        )}
      </div>
    </div>
  );
}
