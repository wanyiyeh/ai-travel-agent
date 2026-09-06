// Single source of truth for IATA airport code -> city data. Previously this
// was four separately maintained tables (src/lib/iataCity.ts's IATA_CITY_ZH,
// src/app/page.tsx's IATA_CITY, src/components/ViewContent.tsx's
// IATA_DISPLAY, src/lib/fetchCityRestaurants.ts's IATA_COORDS) that had to be
// kept in sync by hand — a code added to one and forgotten in another let
// that feature silently degrade (e.g. a missing Nearby Search anchor letting
// the LLM hallucinate a wrong-city place). Add new airports only here.
export interface Airport {
  cityZh: string;
  lat: number;
  lng: number;
}

export const AIRPORTS: Record<string, Airport> = {
  // 東北亞
  NRT: { cityZh: "東京", lat: 35.6762, lng: 139.6503 },
  HND: { cityZh: "東京", lat: 35.6762, lng: 139.6503 },
  KIX: { cityZh: "大阪", lat: 34.6937, lng: 135.5023 },
  NGO: { cityZh: "名古屋", lat: 35.1815, lng: 136.9066 },
  CTS: { cityZh: "札幌", lat: 43.0618, lng: 141.3545 },
  FUK: { cityZh: "福岡", lat: 33.5904, lng: 130.4017 },
  OKA: { cityZh: "沖繩", lat: 26.2124, lng: 127.6809 },
  ICN: { cityZh: "首爾", lat: 37.5665, lng: 126.978 },
  GMP: { cityZh: "首爾", lat: 37.5665, lng: 126.978 },
  PUS: { cityZh: "釜山", lat: 35.1796, lng: 129.0756 },
  PEK: { cityZh: "北京", lat: 39.9042, lng: 116.4074 },
  PKX: { cityZh: "北京", lat: 39.9042, lng: 116.4074 },
  PVG: { cityZh: "上海", lat: 31.2304, lng: 121.4737 },
  SHA: { cityZh: "上海", lat: 31.2304, lng: 121.4737 },
  CAN: { cityZh: "廣州", lat: 23.1291, lng: 113.2644 },
  HKG: { cityZh: "香港", lat: 22.3193, lng: 114.1694 },
  TPE: { cityZh: "台北", lat: 25.033, lng: 121.5654 },
  KHH: { cityZh: "高雄", lat: 22.6273, lng: 120.3014 },
  RMQ: { cityZh: "台中", lat: 24.1477, lng: 120.6736 },
  // 東南亞
  SIN: { cityZh: "新加坡", lat: 1.3521, lng: 103.8198 },
  KUL: { cityZh: "吉隆坡", lat: 3.139, lng: 101.6869 },
  BKK: { cityZh: "曼谷", lat: 13.7563, lng: 100.5018 },
  DMK: { cityZh: "曼谷", lat: 13.7563, lng: 100.5018 },
  HKT: { cityZh: "普吉島", lat: 7.8804, lng: 98.3923 },
  CNX: { cityZh: "清邁", lat: 18.7883, lng: 98.9853 },
  SGN: { cityZh: "胡志明市", lat: 10.8231, lng: 106.6297 },
  HAN: { cityZh: "河內", lat: 21.0285, lng: 105.8542 },
  DAD: { cityZh: "峴港", lat: 16.0544, lng: 108.2022 },
  DPS: { cityZh: "峇里島", lat: -8.6705, lng: 115.2126 },
  CGK: { cityZh: "雅加達", lat: -6.2088, lng: 106.8456 },
  REP: { cityZh: "暹粒", lat: 13.3671, lng: 103.8448 },
  PNH: { cityZh: "金邊", lat: 11.5564, lng: 104.9282 },
  // 大洋洲
  PER: { cityZh: "伯斯", lat: -31.9505, lng: 115.8605 },
  MEL: { cityZh: "墨爾本", lat: -37.8136, lng: 144.9631 },
  SYD: { cityZh: "雪梨", lat: -33.8688, lng: 151.2093 },
  BNE: { cityZh: "布里斯本", lat: -27.4698, lng: 153.0251 },
  AKL: { cityZh: "奧克蘭", lat: -36.8485, lng: 174.7633 },
  // 歐洲
  LHR: { cityZh: "倫敦", lat: 51.5074, lng: -0.1278 },
  LGW: { cityZh: "倫敦", lat: 51.5074, lng: -0.1278 },
  MAN: { cityZh: "曼徹斯特", lat: 53.4808, lng: -2.2426 },
  EDI: { cityZh: "愛丁堡", lat: 55.9533, lng: -3.1883 },
  DUB: { cityZh: "都柏林", lat: 53.3498, lng: -6.2603 },
  CDG: { cityZh: "巴黎", lat: 48.8566, lng: 2.3522 },
  ORY: { cityZh: "巴黎", lat: 48.8566, lng: 2.3522 },
  LYS: { cityZh: "里昂", lat: 45.764, lng: 4.8357 },
  NCE: { cityZh: "尼斯", lat: 43.7102, lng: 7.262 },
  AMS: { cityZh: "阿姆斯特丹", lat: 52.3676, lng: 4.9041 },
  FRA: { cityZh: "法蘭克福", lat: 50.1109, lng: 8.6821 },
  MUC: { cityZh: "慕尼黑", lat: 48.1351, lng: 11.582 },
  BER: { cityZh: "柏林", lat: 52.52, lng: 13.405 },
  HAM: { cityZh: "漢堡", lat: 53.5511, lng: 9.9937 },
  VIE: { cityZh: "維也納", lat: 48.2082, lng: 16.3738 },
  FCO: { cityZh: "羅馬", lat: 41.9028, lng: 12.4964 },
  MXP: { cityZh: "米蘭", lat: 45.4642, lng: 9.19 },
  VCE: { cityZh: "威尼斯", lat: 45.4408, lng: 12.3155 },
  NAP: { cityZh: "那不勒斯", lat: 40.8518, lng: 14.2681 },
  BCN: { cityZh: "巴塞隆納", lat: 41.3874, lng: 2.1686 },
  MAD: { cityZh: "馬德里", lat: 40.4168, lng: -3.7038 },
  LIS: { cityZh: "里斯本", lat: 38.7223, lng: -9.1393 },
  ATH: { cityZh: "雅典", lat: 37.9838, lng: 23.7275 },
  HEL: { cityZh: "赫爾辛基", lat: 60.1699, lng: 24.9384 },
  CPH: { cityZh: "哥本哈根", lat: 55.6761, lng: 12.5683 },
  ARN: { cityZh: "斯德哥爾摩", lat: 59.3293, lng: 18.0686 },
  OSL: { cityZh: "奧斯陸", lat: 59.9139, lng: 10.7522 },
  PRG: { cityZh: "布拉格", lat: 50.0755, lng: 14.4378 },
  BUD: { cityZh: "布達佩斯", lat: 47.4979, lng: 19.0402 },
  BTS: { cityZh: "布拉提斯拉瓦", lat: 48.1486, lng: 17.1077 },
  LJU: { cityZh: "盧布亞納", lat: 46.0569, lng: 14.5058 },
  ZAG: { cityZh: "薩格勒布", lat: 45.815, lng: 15.9819 },
  DBV: { cityZh: "杜布羅夫尼克", lat: 42.6507, lng: 18.0944 },
  SJJ: { cityZh: "薩拉熱窩", lat: 43.8563, lng: 18.4131 },
  BEG: { cityZh: "貝爾格勒", lat: 44.7866, lng: 20.4489 },
  SOF: { cityZh: "索非亞", lat: 42.6977, lng: 23.3219 },
  OTP: { cityZh: "布加勒斯特", lat: 44.4268, lng: 26.1025 },
  WAW: { cityZh: "華沙", lat: 52.2297, lng: 21.0122 },
  KRK: { cityZh: "克拉科夫", lat: 50.0647, lng: 19.945 },
  ZRH: { cityZh: "蘇黎世", lat: 47.3769, lng: 8.5417 },
  GVA: { cityZh: "日內瓦", lat: 46.2044, lng: 6.1432 },
  BRU: { cityZh: "布魯塞爾", lat: 50.8503, lng: 4.3517 },
  IST: { cityZh: "伊斯坦堡", lat: 41.0082, lng: 28.9784 },
  // 中東
  DXB: { cityZh: "杜拜", lat: 25.2048, lng: 55.2708 },
  AUH: { cityZh: "阿布達比", lat: 24.4539, lng: 54.3773 },
  DOH: { cityZh: "多哈", lat: 25.2854, lng: 51.531 },
  // 南亞
  KTM: { cityZh: "加德滿都", lat: 27.7172, lng: 85.324 },
  PKR: { cityZh: "波卡拉", lat: 28.2096, lng: 83.9856 },
  DEL: { cityZh: "德里", lat: 28.6139, lng: 77.209 },
  BOM: { cityZh: "孟買", lat: 19.076, lng: 72.8777 },
  CMB: { cityZh: "可倫坡", lat: 6.9271, lng: 79.8612 },
  // 非洲
  CAI: { cityZh: "開羅", lat: 30.0444, lng: 31.2357 },
  CMN: { cityZh: "卡薩布蘭加", lat: 33.5731, lng: -7.5898 },
  CPT: { cityZh: "開普敦", lat: -33.9249, lng: 18.4241 },
  JNB: { cityZh: "約翰尼斯堡", lat: -26.2041, lng: 28.0473 },
  // 北美
  JFK: { cityZh: "紐約", lat: 40.7128, lng: -74.006 },
  MIA: { cityZh: "邁阿密", lat: 25.7617, lng: -80.1918 },
  LAX: { cityZh: "洛杉磯", lat: 34.0522, lng: -118.2437 },
  SFO: { cityZh: "舊金山", lat: 37.7749, lng: -122.4194 },
  ORD: { cityZh: "芝加哥", lat: 41.8781, lng: -87.6298 },
  SEA: { cityZh: "西雅圖", lat: 47.6062, lng: -122.3321 },
  YYZ: { cityZh: "多倫多", lat: 43.6532, lng: -79.3832 },
  YVR: { cityZh: "溫哥華", lat: 49.2827, lng: -123.1207 },
};

export function iataToCity(iata: string): string {
  return AIRPORTS[iata]?.cityZh ?? iata;
}

export function getIataCoords(iata: string): { lat: number; lng: number } | null {
  const a = AIRPORTS[iata];
  return a ? { lat: a.lat, lng: a.lng } : null;
}

// Reverse of AIRPORTS' cityZh, first code wins per city name (coords are
// identical across a city's codes, e.g. NRT/HND both "東京", so which one
// wins doesn't matter). Every itinerary day's waypointCity/transitTo is
// itself derived from AIRPORTS names (see itineraryGen.ts's
// arrivalCityName/returnCityName), so this round-trips cleanly.
const CITY_ZH_TO_IATA: Record<string, string> = {};
for (const [code, airport] of Object.entries(AIRPORTS)) {
  if (!(airport.cityZh in CITY_ZH_TO_IATA)) CITY_ZH_TO_IATA[airport.cityZh] = code;
}

export function cityToIata(cityName: string): string | undefined {
  return CITY_ZH_TO_IATA[cityName];
}
