import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import { iataToCity } from "@/lib/iataCity";
import { getIataCoords } from "@/lib/fetchCityRestaurants";

export const paceMap: Record<string, string> = {
  relaxed: "悠閒，每天景點不超過 3 個，留有充足休息時間",
  moderate: "適中，每天安排 3-4 個景點",
  intensive: "緊湊，每天安排 5 個以上景點，行程滿檔",
};

export const budgetMap: Record<string, string> = {
  budget: "經濟實惠，偏好免費或低消費景點、平價餐廳",
  moderate: "中等消費，一般觀光景點與餐廳",
  luxury: "高端奢華，頂級餐廳、精品購物、私人導覽",
};

export const interestMap: Record<string, string> = {
  food: "美食",
  culture: "文化歷史",
  nature: "自然景觀",
  shopping: "購物",
  adventure: "冒險戶外活動",
};

export function calcDays(departureDate: string, returnDate: string): number {
  const dep = new Date(departureDate);
  const ret = new Date(returnDate);
  return Math.max(1, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
}

export function buildFlightTimePrompt(flightInfo: FlightInfo): string {
  const lines: string[] = [];
  if (flightInfo.arrivalTime) {
    lines.push(
      `去程航班預計 ${flightInfo.arrivalTime} 抵達目的地，第 1 天行程需在抵達後合理時間（含入境、提領行李、前往市區）才開始。`,
    );
  }
  if (flightInfo.returnDepartureTime) {
    lines.push(
      `回程航班預計 ${flightInfo.returnDepartureTime} 出發，最後一天行程必須在此時間至少 3 小時前結束，以預留前往機場及辦理登機手續的時間。`,
    );
  }
  return lines.length ? "\n\n航班時間限制：\n" + lines.join("\n") : "";
}

export function buildPreferencePrompt(preferences?: TripPreferences): string {
  if (!preferences) return "";
  const lines: string[] = [];
  if (preferences.pace) lines.push(`行程步調：${paceMap[preferences.pace]}。`);
  if (preferences.budget) lines.push(`預算級別：${budgetMap[preferences.budget]}。`);
  if (preferences.interests?.length) {
    const labels = preferences.interests.map((i) => interestMap[i]).join("、");
    lines.push(`旅遊偏好：以${labels}為主。`);
  }
  return lines.length ? "\n\n使用者偏好：\n" + lines.join("\n") : "";
}

export function buildSystemPrompt(
  flightInfo: FlightInfo,
  preferences: TripPreferences | undefined,
  days: number,
  restaurantHintsPrompt = "",
): string {
  const arrivalCityName = iataToCity(flightInfo.arrivalCity);
  const returnCityName = iataToCity(flightInfo.returnDepartureCity);
  const isMultiCity = arrivalCityName !== returnCityName;

  const routeDesc = isMultiCity
    ? `從台灣出發飛往${arrivalCityName}，旅途結束後從${returnCityName}搭機返回`
    : `從台灣出發飛往${arrivalCityName}來回`;

  const multiCityInstructions = isMultiCity
    ? `\n\n【重要：跨城市移動安排 — 總天數不得超過 ${days} 天】\n回程從${returnCityName}出發。在 ${days} 天的總行程中，預設情況下只需分配其中一天作為從${arrivalCityName}移動到${returnCityName}的移動日（isTransitDay: true）。移動日應安排在行程中段（第 2 天到第 ${days - 1} 天之間），依實際地理路線自然移動的時機決定；絕對不可放在第 ${days} 天——第 ${days} 天是旅客從${returnCityName}搭機返台的回程日，不是城際移動日。移動日的出發城市必須是「${arrivalCityName}」，stops 的 name 必須寫「搭乘交通工具從${arrivalCityName}前往${returnCityName}」，description 亦須說明從${arrivalCityName}出發。移動日的 transitTo 欄位填寫「${returnCityName}」（城市名稱，不是機場代碼）。移動日不是額外增加的天數，而是 ${days} 天中的一天。最後一天的景點安排在${returnCityName}。\n\n【多段移動（沿路漸進路線）】若行程本質上是沿同一條路線或區域逐站前進（例如沿海岸公路、鐵路幹線由${arrivalCityName}一路開往${returnCityName}，途中在合理的中途城鎮過夜），可以標記不只一天為移動日（isTransitDay: true）——每次實際換城鎮過夜的當天都標記一次，transitTo 填寫該次移動抵達的城鎮名稱；其中**最後一個**移動日的 transitTo 必須是「${returnCityName}」。這種情況下，中途城鎮不算違規新增的額外目的地（仍嚴禁自行加入路線以外的觀光新城市/國家，見規則 6），但每一天都必須誠實填寫 waypointCity 為當天實際所在城鎮，讓行程真實反映漸進路線。\n\n【移動日時機限制】每一個移動日都必須是旅客**第一次**入住其 transitTo 城鎮的當天——即移動日當晚住宿才開始換到新城鎮，之前的住宿都在上一個城鎮；嚴禁在旅客已連續住在某城鎮之後，於後段天次才出現該城鎮的移動日。`
    : "";

  return `你是專業的旅遊規劃專家。請為用戶規劃 ${days} 天的旅遊行程。
航班資訊：${routeDesc}。
出發日期：${flightInfo.departureDate}，回程日期：${flightInfo.returnDate}。
第 1 天對應 ${flightInfo.departureDate}，以此類推。${multiCityInstructions}${buildFlightTimePrompt(flightInfo)}${buildPreferencePrompt(preferences)}

嚴格遵守以下 JSON 結構：
{
  "title": "行程標題（繁體中文）",
  "currency": "JPY",
  "days": [
    {
      "day": 1,
      "theme": "主題（可選，繁體中文）",
      "waypointCity": "${arrivalCityName}",
      "stops": [
        {
          "name": "景點名稱",
          "description": "景點描述",
          "duration_minutes": 180,
          "time_of_day": "morning",
          "transport_from_prev": "從機場搭乘地鐵約 30 分鐘",
          "estimated_cost": 1500
        }
      ],
      "accommodation": {
        "area": "住宿區域（如：新宿、淺草、銀座）",
        "reason": "推薦此區域的理由（地理位置、交通便利性等，一句話）"
      },
      "meals": {
        "breakfast": { "name": "早餐店名稱", "description": "簡短描述", "estimated_cost": 600 },
        "lunch": { "name": "午餐店名稱", "description": "簡短描述", "estimated_cost": 1200 },
        "dinner": { "name": "晚餐店名稱", "description": "簡短描述", "estimated_cost": 2500 }
      }
    },
    {
      "day": "<中段某天，例如第 ${Math.ceil(days / 2)} 天，依地理路線決定>",
      "theme": "跨城移動日（僅多城市行程適用，絕不可放在第 ${days} 天）",
      "isTransitDay": true,
      "transitTo": "${returnCityName}",
      "waypointCity": "${arrivalCityName}",
      "stops": [
        {
          "name": "搭乘火車從${arrivalCityName}前往${returnCityName}",
          "description": "從${arrivalCityName}中央車站搭乘火車前往${returnCityName}，車程約4小時。",
          "duration_minutes": 240,
          "time_of_day": "morning",
          "transport_from_prev": "從住宿前往火車站步行約 10 分鐘",
          "estimated_cost": 13000
        }
      ],
      "accommodation": null,
      "meals": {
        "breakfast": { "name": "早餐店名稱", "description": "簡短描述", "estimated_cost": 600 },
        "lunch": { "name": "午餐店名稱", "description": "簡短描述", "estimated_cost": 1200 },
        "dinner": { "name": "晚餐店名稱", "description": "簡短描述", "estimated_cost": 2500 }
      }
    }
  ]
}

重要規則：
1. JSON Key 必須是英文
2. 所有 Value（景點名稱、描述、主題、住宿、交通描述）必須使用繁體中文；currency 例外，使用 ISO 4217 貨幣代碼（如 JPY、AUD、USD）
3. day 從 1 開始計數
4. duration_minutes 必須是數字（分鐘）
5. 每天至少要有 2 個景點，每天 3-5 個景點為佳；即使整天都在同一個大型場地（如國家公園、主題樂園、滑雪場），也必須按時段拆分為至少 2 個獨立 stop（例如國家公園晨間遊獵 morning、午後遊獵 afternoon），不可將整天活動合併為單一 stop
6. 所有景點與住宿必須實際位於旅遊目的地範圍內：一般停留天數只能在 ${flightInfo.arrivalCity} 的景點；${isMultiCity ? `最後一天景點只能在 ${flightInfo.returnDepartureCity}；若行程屬於沿路漸進移動（見上方【多段移動】說明），中途每一天的景點僅限於當天 waypointCity 所在的城鎮本身，且該城鎮必須是從 ${arrivalCityName} 前往 ${returnCityName} 路線上合理途經的城鎮；` : ""}嚴禁自行加入路線以外的額外目的地城市或國家作為觀光新增停留點（額外中途停留由使用者另行選擇，初始行程不得自行插入非路線上的城鎮）
7. accommodation 為每天的住宿建議，只需填寫區域（area）與推薦理由（reason），不需指定特定飯店名稱；只有 isTransitDay: true 的移動日，以及第 ${days} 天（回程日，即 ${flightInfo.returnDate}）不需要住宿，accommodation 設為 null；第 1 天到第 ${days - 1} 天中所有非移動日，即使是行程最後在目的地的休閒日或準備回程日，都必須填寫住宿
8. time_of_day 必須填寫，值只能是 "morning"（早上）、"afternoon"（下午）、"evening"（晚上）之一；每天景點必須至少橫跨兩個不同時段（不可全部集中在單一時段），並盡量合理分配至早中晚三個時段
9. transport_from_prev 必須填寫，描述如何從上一個景點（或住宿、機場）前往此景點，例如「步行約 10 分鐘」、「搭乘地鐵約 15 分鐘」、「搭計程車約 20 分鐘」；第 1 天第一個景點填寫從機場前往的交通方式，其他天第一個景點填寫從住宿前往的交通方式；交通時間必須符合現實地理距離，不可填寫明顯不合理的交通時間（例如將距離數小時車程的遠郊景點寫成「搭公共交通 30 分鐘」）
10. currency 必須填寫，使用目的地當地貨幣的 ISO 4217 代碼
11. estimated_cost 必須填寫，為該景點的預估花費（門票、餐飲、活動費用等），以 currency 為單位的整數；免費景點填 0
12. meals 必須填寫，早餐、午餐、晚餐各推薦一家當地實際存在的**獨立餐廳或咖啡館**；name 必須為具體可查詢的真實店名（如「Odyssea Waterfront」、「Little Creatures Brewery」、「Hardware Société」），嚴禁使用描述性泛稱（如「當地餐廳」、「酒店餐廳」、「度假村自助早餐」、「海鮮餐廳」、「機場餐廳」、「當地咖啡館」、「當地酒吧餐廳」等）；若對偏遠地點不確定具體店名，可選擇鄰近小鎮已知的咖啡館或酒館並給出具體名稱，絕對不可以泛稱代替。description 為一句話簡介（風格、招牌菜等），estimated_cost 為每人平均消費（以 currency 為單位的整數）。
    【早餐與午晚餐取材來源不同】早餐（breakfast）必須優先從下方【已驗證當地早餐地點清單】（咖啡館、麵包店、早餐專門店、早午餐餐廳等類型）選取；午餐（lunch）與晚餐（dinner）必須優先從下方【已驗證當地餐廳清單】（餐廳類）選取；兩份清單各自對應不同的 Google Place Type，不可混用——早餐不可選用餐廳清單中的店家，午晚餐也不可選用早餐清單中的地點。
    【禁止作為餐廳推薦的場所類型】以下類型一律禁止出現在 meals 中：①飯店/旅館本身（如「ibis Amsterdam」、「DoubleTree by Hilton」、「The Hoxton」、「Leonardo Hotel」、「Hotel Casa」等連鎖或獨立旅館名稱——除非指定的是該飯店內有獨立命名的附設餐廳，且 name 填寫該餐廳的具體名稱而非飯店名稱）；②賭場（Casino）；③露營地（Camping/Campsite）；④博物館、美術館、文化機構本身（如「Eye Film Museum」、「Arab World Institute」——除非其內部有獨立命名的咖啡館/餐廳且 name 填其名而非館名）；⑤超市、便利商店、停車場、購物中心本身。
    【早餐場所限制】早餐（breakfast）不限於西式咖啡館/麵包店，也可以是當地風格的早餐專門店（例如日式定食屋、粥店、早餐店、豆漿店等只在白天供應早餐/早午餐的場所），只要該店家實際有提供早餐時段即可。嚴禁將拉麵店、壽司店、燒肉店、牛排館、酒吧等**通常僅在午餐或晚餐時段營業、不供應早餐**的場所列為早餐。
    金額必須符合當地物價實際水準，各地參考範圍如下——日本（JPY）早餐約 500-1000、午餐約 1000-2000、晚餐約 2000-5000；歐元區（EUR，如法國、德國、義大利、西班牙）早餐約 8-15、午餐約 15-25、晚餐約 30-60；英國（GBP）早餐約 8-15、午餐約 15-25、晚餐約 30-60；瑞士（CHF）早餐約 15-25、午餐約 25-40、晚餐約 50-100；澳洲（AUD）早餐約 15-25、午餐約 20-35、晚餐約 40-80；紐西蘭（NZD）早餐約 15-25、午餐約 20-35、晚餐約 40-80；美國（USD）早餐約 10-20、午餐約 15-30、晚餐約 30-60；台灣（TWD）早餐約 50-120、午餐約 120-250、晚餐約 250-600；韓國（KRW）早餐約 5000-10000、午餐約 8000-15000、晚餐約 15000-40000；泰國（THB）早餐約 60-150、午餐約 100-250、晚餐約 200-600；新加坡（SGD）早餐約 4-10、午餐約 10-20、晚餐約 20-50；香港（HKD）早餐約 30-80、午餐約 60-130、晚餐約 150-350；越南（VND）早餐約 30000-80000、午餐約 60000-150000、晚餐約 100000-300000；馬來西亞（MYR）早餐約 5-15、午餐約 10-25、晚餐約 20-60；印尼（IDR）早餐約 20000-50000、午餐約 40000-100000、晚餐約 80000-250000；瑞典（SEK）早餐約 80-150、午餐約 150-280、晚餐約 350-800；丹麥（DKK）早餐約 60-120、午餐約 120-220、晚餐約 280-650；挪威（NOK）早餐約 90-160、午餐約 160-280、晚餐約 350-850；南非（ZAR）早餐約 80-150、午餐約 150-300、晚餐約 300-700；請根據目的地貨幣選取對應範圍，勿填寫明顯偏低的金額
13. 若行程中連續多天沿同一條路線或區域移動（例如沿海岸公路、鐵路幹線逐站前進），每天的住宿地點必須沿移動方向漸進安排在當天行程的終點附近，不可安排住宿比前一晚更靠近原本的起點，造成隔天回頭重複經過已走過的路段；只有當某天是以同一城市/基地出發再返回過夜的一日遊（而非沿路線前進）時，才可以連續多天使用同一住宿
14. isTransitDay: true 的移動日中，stop 的 estimated_cost 必須填寫實際的城際交通票價，不可填寫明顯偏低的金額；各類交通工具參考票價如下——日本新幹線（如東京↔大阪）自由席約 13,000-14,000 JPY、指定席約 14,000-15,000 JPY；日本特急列車（如東京↔仙台）約 10,000-12,000 JPY；日本夜行巴士約 3,000-8,000 JPY；台灣高鐵（如台北↔高雄）約 1,500-2,000 TWD；韓國 KTX（如首爾↔釜山）約 60,000-70,000 KRW；歐洲高速鐵路（如巴黎↔阿姆斯特丹）約 50-150 EUR；東南亞城際巴士約 300-1,500 THB / 50,000-200,000 VND；若為飛機，依航線距離估算票價：短程（2小時以內）約 USD 50-150 / AUD 100-250；中長程（如澳洲跨州航班 PER↔MEL、PER↔SYD 等）約 AUD 250-600；請根據實際城市距離與交通方式選取合理金額
15. 【反重複強制規則】同一行程中，同一餐廳名稱絕對不可在任何天、任何餐次重複出現，違反此規則視為生成失敗。執行方式：在腦中建立一份「已用餐廳名單」，每填入一家餐廳前先查閱名單確認該店名從未出現過，確認後才填入並立即加入名單；若想填入的店名已在名單中，必須換一家不同的餐廳。每天早、午、晚三餐也必須互不重複。使用相同描述性泛稱（如「當地咖啡館」）亦視同重複，一律禁止。對於餐廳資源較少的偏遠地區（如國家公園營地、山區度假村），若同一區域連續停留多天，可使用同一露營區內不同的餐飲場所（如 Skukuza Camp 的 Cattle Baron、Berg-en-Dal 的 Mugg & Bean），或輪替附近不同小鎮的餐廳，但同一家店名仍不得重複。**移動日（isTransitDay: true）的三餐同樣適用此規則**：即使當天大部分時間在交通工具或機場，仍須給出具名真實店家（如交通樞紐內可查詢的特定餐廳、抵達城市的具名餐廳），嚴禁使用「機場餐廳」、「車站餐廳」、「高速公路休息站」等任何泛稱；若下午已抵達${isMultiCity ? returnCityName : "目的城市"}，晚餐應安排該城市的具名餐廳
16. 景點名稱必須為具體可前往的單一地點（如「愛丁堡城堡」、「大英博物館」），禁止使用廣泛地理區域作為景點（如「蘇格蘭高地」、「海岸地帶」、「市郊鄉間」）；若要安排自然景觀體驗，必須指定具體地點名稱（如「格倫科峽谷 Glencoe」、「尼斯湖 Loch Ness」、「本尼維斯山基地步道」）。同樣嚴禁使用描述性泛稱代替真實地點名稱（如「名古屋美食街」、「海濱步道」、「XX之家」）——這類名稱在地圖上查無單一對應地點，容易被誤配對到其他城市甚至其他國家的同名地點；必須填寫該地點在 Google 地圖上可查詢到的實際名稱（如以「大須商店街」取代「名古屋美食街」、以「South Pointe Park」取代「海濱步道」）。若不確定具體名稱，寧可選擇該城市已知的真實街道、公園或商店街名稱，也不可自創泛稱
17. 移動日（isTransitDay: true）若城際交通的 time_of_day 為 morning，代表旅客下午已抵達目的城市；stops 中必須加入至少 1 個 time_of_day 為 afternoon 或 evening 的輕鬆景點；若交通為 afternoon，則至少加入一個 evening 景點；移動日抵達後的時間不應完全空白；抵達後加入的景點必須位於**抵達城市市區範圍內**（活動類型可參考：市中心街道漫步、鄰近咖啡館、城市廣場、濱海步道等，但實際填入的景點名稱仍須是該城市真實可查詢的具體地點，不可直接使用類型詞本身作為景點名稱），**嚴禁安排需額外長途移動的郊外景點或一日遊**（例如飛抵墨爾本當天不可安排菲利普島、大洋路等需車程 1 小時以上的郊外行程）
18. 同一行程中，同一景點名稱不得在不同天重複出現；若某景點已在前幾天安排，後續天數必須替換為不同景點，確保整份行程景點多元不重複
19. waypointCity 為必填欄位，每一天都必須誠實填寫當天景點與住宿實際所在的城市或城鎮名稱（使用與 arrivalCity/returnDepartureCity 一致的城市命名方式）；一般情況下這個值就是 ${arrivalCityName}${isMultiCity ? ` 或 ${returnCityName}` : ""}，只有在【多段移動（沿路漸進路線）】情境下才會出現路線上的其他中途城鎮名稱${restaurantHintsPrompt}`;
}

/**
 * Best-effort coordinate for a day's candidate searches (accommodation, meals):
 * prefer the centroid of the day's own geocoded stops, then fall back to
 * sibling days sharing the same waypointCity (an empty/not-yet-enriched day
 * still gets a sensible search origin), then the flight's arrival city.
 */
export function resolveDayCoords(
  days: Record<string, unknown>[],
  day: Record<string, unknown>,
  arrivalIataCode?: string,
): { lat: number; lng: number } | null {
  const stops = (day.stops as Record<string, unknown>[]) ?? [];
  const enrichedStops = stops.filter(
    (s) => typeof s.lat === "number" && typeof s.lng === "number"
  ) as { lat: number; lng: number }[];

  if (enrichedStops.length > 0) {
    return {
      lat: enrichedStops.reduce((sum, s) => sum + s.lat, 0) / enrichedStops.length,
      lng: enrichedStops.reduce((sum, s) => sum + s.lng, 0) / enrichedStops.length,
    };
  }

  const waypointCity = typeof day.waypointCity === "string" ? day.waypointCity : undefined;
  const sameCityStops = waypointCity
    ? (days
        .filter((d) => d.waypointCity === waypointCity)
        .flatMap((d) => (d.stops as Record<string, unknown>[]) ?? [])
        .filter(
          (s) => typeof s.lat === "number" && typeof s.lng === "number"
        ) as { lat: number; lng: number }[])
    : [];

  if (sameCityStops.length > 0) {
    return {
      lat: sameCityStops.reduce((sum, s) => sum + s.lat, 0) / sameCityStops.length,
      lng: sameCityStops.reduce((sum, s) => sum + s.lng, 0) / sameCityStops.length,
    };
  }

  return arrivalIataCode ? getIataCoords(arrivalIataCode) : null;
}

export function tagWaypointCities<
  T extends {
    isTransitDay?: boolean | null;
    transitTo?: string | null;
    waypointCity?: string | null;
  },
>(days: T[], startCity: string): (T & { waypointCity?: string })[] {
  let currentCity = startCity;
  return days.map((day) => {
    if (day.isTransitDay) {
      const departCity = currentCity;
      if (day.transitTo) currentCity = day.transitTo;
      // Transit day starts in departCity — tag it so enrichment uses the right city
      return { ...day, waypointCity: departCity } as T & { waypointCity?: string };
    }
    // Trust the AI's own declaration when present — this is what lets a
    // progressive/multi-segment route name a genuine intermediate waypoint
    // town instead of only ever inferring city from the isTransitDay chain.
    // Falls back to the chain for legacy responses that omit the field.
    const declared = day.waypointCity;
    const city = declared && declared.trim() ? declared : currentCity;
    currentCity = city;
    return { ...day, waypointCity: city };
  });
}

export function repairTransitDayDepartureCities<
  T extends {
    isTransitDay?: boolean | null;
    transitTo?: string | null;
    waypointCity?: string;
    stops: Array<{ name: string; description: string }>;
  },
>(days: T[]): T[] {
  // Each transit day's own tagged waypointCity IS its departure city (set by
  // tagWaypointCities before this runs) — using it per-day instead of a single
  // global fromCity/toCity pair keeps this correct across multi-segment routes,
  // where the 2nd/3rd transit day departs from an intermediate waypoint town,
  // not the original arrival city.
  return days.map((day) => {
    const toCity = day.transitTo;
    const fromCity = day.waypointCity;
    if (!day.isTransitDay || !toCity || !fromCity) return day;

    const mentionsCorrect = day.stops.some(
      (s) => s.name.includes(fromCity) || s.description.includes(fromCity),
    );
    if (mentionsCorrect) return day;

    const transportStop = day.stops.find((s) => s.name.includes(toCity));
    if (!transportStop) return day;

    const match = transportStop.name.match(/從(.+?)(?:前往|搭乘)/);
    if (!match) return day;

    const wrongCity = match[1].trim();
    console.warn(`[Transit Repair] "${wrongCity}" → "${fromCity}" in transit to ${toCity}`);

    return {
      ...day,
      stops: day.stops.map((s) => ({
        ...s,
        name: s.name.replaceAll(wrongCity, fromCity),
        description: s.description.replaceAll(wrongCity, fromCity),
      })),
    };
  });
}

