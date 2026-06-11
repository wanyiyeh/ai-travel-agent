/**
 * Test data seed script — creates 4 itineraries covering F1-F5 test scenarios.
 * Run: npm run seed
 *
 * Scenarios:
 *   A  5天維也納        F4 AI智能插入點（各天stop數不同）
 *   B  維也納→布達佩斯   F1 移動日 Fill-the-Gaps（移動日只有1個stop）
 *   C  歐洲12天         F5 購物車天數上限測試
 *   D  住宿缺失行程      F3 Graceful Degradation（accommodation=null）
 */

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const SEED_MARKER = "[TEST-SEED]";

const prisma = new PrismaClient();

// ─── helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return randomUUID();
}

function stop(name, description, duration_minutes, time_of_day, transport_from_prev, estimated_cost) {
  return { id: uid(), name, description, duration_minutes, time_of_day, transport_from_prev, estimated_cost };
}

function day(dayNum, theme, stops, accommodation, meals, extra = {}) {
  return {
    id: uid(),
    day: dayNum,
    theme,
    stops: stops.map((s, i) => ({ ...s, orderIndex: i })),
    accommodation,
    meals,
    ...extra,
  };
}

function hotel(name, area) {
  return { name, area };
}

function meals(breakfast, lunch, dinner) {
  return {
    breakfast: { name: breakfast, description: "推薦", estimated_cost: 12 },
    lunch:     { name: lunch,     description: "推薦", estimated_cost: 20 },
    dinner:    { name: dinner,    description: "推薦", estimated_cost: 35 },
  };
}

function config(totalDays, arrivalCity, returnDepartureCity, currency = "EUR") {
  return JSON.stringify({
    generatedWith: SEED_MARKER,
    totalDays,
    createdAt: new Date().toISOString(),
    isStreamed: false,
    flightInfo: {
      departureCity: "TPE",
      arrivalCity,
      returnDepartureCity,
      departureDate: "2026-07-01",
      returnDate: `2026-07-${String(totalDays).padStart(2, "0")}`,
      arrivalTime: "14:00",
      returnDepartureTime: "18:00",
    },
    preferences: null,
    currency,
  });
}

// ─── Scenario A：5天維也納（測試 F4 AI智能插入點）──────────────────────────────
// 各天stop數刻意不同，讓AI有明確判斷依據：Day3最閒 → 適合插入前後

const scenarioA_days = [
  day(1, "抵達維也納", [
    stop("維也納中央車站", "乘火車抵達市區", 30, "morning", "從機場搭乘機場快線約16分鐘", 4),
    stop("聖史蒂芬大教堂", "哥德式建築地標，可登塔俯瞰維也納全景", 90, "afternoon", "搭乘地鐵U1約10分鐘", 0),
  ], hotel("Hotel Sacher Wien", "第一區 · 市中心"), meals("咖啡館早餐", "Figlmüller", "Zum Wohl")),

  day(2, "宮殿與藝術日（行程最密）", [
    stop("美泉宮", "哈布斯堡王朝夏宮，UNESCO世界遺產，含花園", 150, "morning", "搭地鐵U4約15分鐘", 22),
    stop("卡爾廣場跳蚤市場", "週末限定，藝術品與古物", 60, "afternoon", "步行約10分鐘", 0),
    stop("維也納藝術史博物館", "世界頂尖藝術收藏之一", 120, "afternoon", "步行約8分鐘", 18),
    stop("維也納歌劇院", "外觀參觀，可選購當晚演出票", 45, "evening", "步行約5分鐘", 30),
    stop("納許市場", "維也納最著名的露天市場，晚餐覓食", 60, "evening", "步行約7分鐘", 25),
  ], hotel("Hotel Sacher Wien", "第一區 · 市中心"), meals("Café Central", "市場小食", "Steirereck im Stadtpark")),

  day(3, "輕鬆漫遊日（最閒 → 理想插入點）", [
    stop("維也納普拉特遊樂園", "老式摩天輪與綠地，輕鬆散步", 120, "morning", "搭地鐵U1約12分鐘", 12),
    stop("多瑙河畔散步", "沿岸漫步，咖啡廳小憩", 60, "afternoon", "步行約15分鐘", 5),
  ], hotel("Hotel Sacher Wien", "第一區 · 市中心"), meals("Café Hawelka", "Zum Wohl午市", "Plachutta")),

  day(4, "皇宮與音樂（行程密）", [
    stop("霍夫堡皇宮", "奧匈帝國中心，參觀皇家公寓", 120, "morning", "步行約20分鐘", 16),
    stop("維也納西班牙馬術學校", "古典馬術表演，需提前訂票", 90, "morning", "步行約5分鐘", 35),
    stop("維也納博物館區", "MuMoK現代藝術博物館", 90, "afternoon", "步行約10分鐘", 12),
    stop("貝多芬紀念館", "樂聖故居，音樂迷必訪", 60, "afternoon", "步行約8分鐘", 8),
  ], hotel("Hotel Sacher Wien", "第一區 · 市中心"), meals("Café Landtmann", "Meixner's Gastwirtschaft", "Vinothek W")),

  day(5, "返程日", [
    stop("卡格蘭購物中心", "最後採購伴手禮", 90, "morning", "步行至地鐵站約5分鐘", 50),
    stop("維也納機場報到", "提早3小時抵達辦理登機", 30, "afternoon", "搭機場快線約16分鐘", 4),
  ], null, meals("飯店早餐", "機場輕食", "—")),
];

// ─── Scenario B：維也納→布達佩斯7天（測試 F1 Fill-the-Gaps 移動日）────────────
// Day4是移動日，只有1個stop（交通），用來驗證F1會補充早晨微行程和抵達下午遊覽

const scenarioB_days = [
  day(1, "抵達維也納", [
    stop("維也納機場快線", "搭乘S7快線入市區", 30, "morning", "出機場即可搭乘", 4),
    stop("聖史蒂芬大教堂", "維也納必訪地標", 90, "afternoon", "步行約15分鐘", 0),
    stop("格拉本步行街", "維也納最繁華購物街，鼠疫紀念柱", 60, "evening", "步行約5分鐘", 20),
  ], hotel("NH Wien Belvedere", "第三區"), meals("機場咖啡", "Do&Co", "Zum Wohl")),

  day(2, "維也納宮殿日", [
    stop("美泉宮花園", "免費入園，晨光散步", 60, "morning", "搭地鐵U4約15分鐘", 0),
    stop("美泉宮皇家公寓", "40間廳室導覽", 120, "morning", "即在美泉宮", 22),
    stop("奧地利應用藝術博物館（MAK）", "設計愛好者必訪", 90, "afternoon", "搭地鐵約8分鐘", 12),
    stop("維也納歌劇院夜間場", "布景精緻，演出水準高", 150, "evening", "步行約10分鐘", 50),
  ], hotel("NH Wien Belvedere", "第三區"), meals("Café Central", "Figlmüller", "歌劇院附近酒吧")),

  day(3, "藝術博物館與多瑙河", [
    stop("維也納藝術史博物館", "世界級名畫收藏", 150, "morning", "搭地鐵U3約10分鐘", 18),
    stop("多瑙河運河漫步", "沿岸街頭藝術牆", 60, "afternoon", "步行約15分鐘", 0),
    stop("普拉特摩天輪", "1897年古典摩天輪，城市全景", 45, "afternoon", "搭地鐵U1約12分鐘", 12),
  ], hotel("NH Wien Belvedere", "第三區"), meals("Café Schwarzenberg", "Naschmarkt小食", "Meixner's")),

  day(4, "移動日：維也納 → 布達佩斯", [
    stop("搭乘 Railjet 高速列車前往布達佩斯 Keleti 站", "維也納 Wien Hauptbahnhof 出發，約2.5小時抵達布達佩斯", 150, "morning", "從住宿步行至中央車站約10分鐘", 39),
  ], null, meals("維也納車站早餐", "火車上簡餐", "布達佩斯 Gerbeaud"), {
    isTransitDay: true,
    transitTo: "布達佩斯",
  }),

  day(5, "布達佩斯初探", [
    stop("英雄廣場", "千年歷史紀念碑，必拍地標", 60, "morning", "從住宿搭地鐵約10分鐘", 0),
    stop("塞切尼浴場", "新文藝復興式溫泉浴場", 150, "afternoon", "步行約10分鐘", 18),
    stop("大市場廳", "匈牙利最大傳統市場，購買辣椒粉與手工藝品", 60, "afternoon", "步行約15分鐘", 30),
    stop("多瑙河沿岸夜景", "從佩斯側欣賞布達城堡夜景", 45, "evening", "步行約20分鐘", 0),
  ], hotel("Aria Hotel Budapest", "第五區 · 市中心"), meals("New York Café", "街頭蘭格什", "Gerbeaud")),

  day(6, "布達山丘與城堡", [
    stop("布達城堡", "UNESCO世界遺產，含匈牙利國家畫廊", 150, "morning", "搭城堡纜車上山約5分鐘", 8),
    stop("馬加什教堂", "布達佩斯最美麗的教堂之一", 60, "morning", "步行約5分鐘", 4),
    stop("漁夫堡", "童話般的觀景台，免費入場", 60, "afternoon", "步行約3分鐘", 0),
    stop("猶太會堂", "歐洲最大猶太會堂", 60, "afternoon", "搭地鐵約15分鐘", 8),
  ], hotel("Aria Hotel Budapest", "第五區 · 市中心"), meals("Ruszwurm Cukrászda", "Frici Papa", "Borkonyha")),

  day(7, "返程日", [
    stop("國會大廈外觀", "世界第三大國會建築，晨光拍攝最美", 60, "morning", "步行約10分鐘", 0),
    stop("布達佩斯 Keleti 站出發", "搭乘 Railjet 返回維也納機場", 30, "afternoon", "搭地鐵至車站約15分鐘", 39),
  ], null, meals("Gerbeaud早餐", "機場輕食", "—")),
];

// ─── Scenario C：歐洲12天（測試 F5 購物車天數上限）──────────────────────────────
// 已是12天滿行程，加入購物車時應觸發紅色警告

const scenarioC_days = [
  day(1, "抵達維也納", [
    stop("維也納機場快線", "入市區", 30, "morning", "出機場即可", 4),
    stop("市政廳廣場", "哥德式市政廳外觀", 60, "afternoon", "步行約10分鐘", 0),
  ], hotel("Hotel Kunsthaus Wien", "第三區"), meals("機場咖啡", "市政廳廣場小食", "Zum Wohl")),

  day(2, "維也納藝術與皇宮", [
    stop("美泉宮", "皇宮花園晨遊", 120, "morning", "搭地鐵U4", 22),
    stop("藝術史博物館", "世界級收藏", 120, "afternoon", "搭地鐵U3", 18),
    stop("歌劇院附近漫步", "夜間散步", 60, "evening", "步行", 0),
  ], hotel("Hotel Kunsthaus Wien", "第三區"), meals("Café Central", "Figlmüller", "Steirereck")),

  day(3, "維也納 → 布拉提斯拉瓦 移動日", [
    stop("搭乘 EC 列車前往布拉提斯拉瓦 hl.st.站", "約1小時車程，班次頻繁", 60, "morning", "從住宿步行至中央車站約10分鐘", 15),
  ], null, meals("火車站早餐", "火車簡餐", "布拉提斯拉瓦 UFO Restaurant"), {
    isTransitDay: true,
    transitTo: "布拉提斯拉瓦",
  }),

  day(4, "布拉提斯拉瓦探索", [
    stop("布拉提斯拉瓦城堡", "俯瞰多瑙河的白色城堡", 90, "morning", "從住宿步行30分鐘或搭計程車", 8),
    stop("老城區漫步", "充滿中世紀風情的石板路", 120, "afternoon", "步行下山約20分鐘", 0),
    stop("UFO Bridge觀景台", "多瑙河橋上的未來感觀景台", 60, "evening", "步行約15分鐘", 8),
  ], hotel("Hotel Marrol's", "老城區"), meals("Slovak Pub", "街頭小食", "UFO Restaurant")),

  day(5, "布拉提斯拉瓦 → 布達佩斯 移動日", [
    stop("搭乘 RegioJet 巴士前往布達佩斯 Keleti 站", "約2.5小時，提供WiFi與飲料", 150, "morning", "從住宿步行至巴士站約10分鐘", 12),
  ], null, meals("早餐包", "巴士上簡餐", "布達佩斯 Gerbeaud"), {
    isTransitDay: true,
    transitTo: "布達佩斯",
  }),

  day(6, "布達佩斯浴場與市場", [
    stop("塞切尼浴場", "必泡的百年溫泉", 180, "morning", "搭地鐵M1", 18),
    stop("大市場廳", "辣椒粉、匈牙利香腸採購", 60, "afternoon", "步行", 40),
    stop("多瑙河游輪", "夜間燈光遊船", 90, "evening", "計程車至碼頭", 35),
  ], hotel("Prestige Hotel Budapest", "第五區"), meals("New York Café", "市場小食", "游輪上自助餐")),

  day(7, "布達城堡區", [
    stop("布達城堡", "UNESCO世界遺產全區", 150, "morning", "搭纜車", 8),
    stop("馬加什教堂 & 漁夫堡", "雙景點打卡", 90, "afternoon", "步行", 4),
    stop("多瑙河夜景酒吧", "Ruin Pub文化體驗", 90, "evening", "搭地鐵", 20),
  ], hotel("Prestige Hotel Budapest", "第五區"), meals("Ruszwurm", "Gerbeaud", "Szimpla Kert")),

  day(8, "布達佩斯 → 布拉格 移動日", [
    stop("搭乘 RegioJet 夜間巴士前往布拉格 ÚAN Florenc", "約6小時夜巴，含WiFi", 360, "evening", "從住宿搭計程車至巴士站", 25),
  ], null, meals("飯店早餐", "車站輕食", "巴士上補眠"), {
    isTransitDay: true,
    transitTo: "布拉格",
  }),

  day(9, "布拉格老城廣場", [
    stop("布拉格城堡", "世界最大城堡群，含聖維特大教堂", 180, "morning", "從住宿搭地鐵A線", 15),
    stop("查理大橋", "巴洛克風格雕塑，徒步橫跨伏爾塔瓦河", 60, "afternoon", "步行下坡約15分鐘", 0),
    stop("老城廣場天文鐘", "整點報時機械鐘，必看景點", 45, "afternoon", "步行約10分鐘", 0),
  ], hotel("Hotel Josef Prague", "老城區"), meals("Café Louvre", "U Zlaté studně", "Lokál")),

  day(10, "布拉格波希米亞風", [
    stop("猶太區（Josefov）", "六座猶太會堂，歷史深厚", 120, "morning", "步行約10分鐘", 15),
    stop("跳舞的房子", "Frank Gehry設計的解構主義建築", 30, "afternoon", "步行約15分鐘", 0),
    stop("瓦茨拉夫廣場夜市", "購物與夜間街頭文化", 90, "evening", "搭地鐵B線", 30),
  ], hotel("Hotel Josef Prague", "老城區"), meals("Café Savoy", "Lokál街邊小食", "Field Restaurant")),

  day(11, "布拉格深度文化", [
    stop("布拉格市立博物館", "波希米亞歷史完整脈絡", 90, "morning", "步行約10分鐘", 8),
    stop("雷特納公園俯瞰全城", "免費城市全景，巨型城市模型", 60, "afternoon", "步行上山約20分鐘", 0),
    stop("伏爾塔瓦河遊船", "黃金時光遊覽布拉格水岸", 90, "afternoon", "搭地鐵至碼頭", 20),
    stop("Vinohrady 葡萄園區酒吧一條街", "在地人喝酒的地方", 90, "evening", "搭地鐵A線", 25),
  ], hotel("Hotel Josef Prague", "老城區"), meals("Café Imperial", "Mincovna", "Eska")),

  day(12, "布拉格 · 返程", [
    stop("萊特納莊園紀念品採購", "布拉格當地設計品牌", 60, "morning", "步行至老城區", 50),
    stop("PRG 布拉格機場辦理登機", "提早3小時抵達", 30, "afternoon", "搭機場巴士AE線約35分鐘", 2),
  ], null, meals("飯店早餐", "機場輕食", "—")),
];

// ─── Scenario D：住宿缺失測試（測試 F3 Graceful Degradation）────────────────────
// Day2 和 Day4 的 accommodation 故意為 null，模擬 AI 生成失敗或資料缺失

const scenarioD_days = [
  day(1, "抵達東京", [
    stop("成田機場 → 上野站", "搭乘成田特快 N'EX，約55分鐘", 55, "morning", "從機場搭乘NEX", 3000),
    stop("上野公園", "博物館群與不忍池，輕鬆入境後漫步", 90, "afternoon", "步行約5分鐘", 0),
    stop("阿美橫丁夜市", "昭和風格商店街，採購零食與乾貨", 60, "evening", "步行約5分鐘", 2000),
  ], hotel("Hotel Metropolitan Ueno", "台東區 · 上野"), meals("成田機場 便當", "上野精養軒", "阿美橫丁 海鮮丼")),

  day(2, "淺草與晴空塔（住宿資料缺失）", [
    stop("淺草寺", "東京最古老的寺廟，仲見世商店街", 120, "morning", "搭乘地鐵銀座線至淺草站", 500),
    stop("晴空塔", "世界第二高電波塔，展望台視野絕佳", 120, "afternoon", "步行約15分鐘", 2100),
    stop("墨田水族館", "晴空塔旁附設，企鵝展區人氣高", 90, "afternoon", "即在晴空塔商場內", 2300),
    stop("淺草橋 EDO WONDERLAND", "江戶時代主題夜遊", 90, "evening", "步行至淺草橋站約10分鐘", 1500),
  ], null, meals("淺草 珈琲店", "駒形 どぜう", "向島 百花園附近料亭")),

  day(3, "新宿與原宿", [
    stop("明治神宮", "東京最莊嚴的神社，晨間參拜", 60, "morning", "搭JR山手線至原宿站", 0),
    stop("竹下通", "原宿青少年流行文化聖地", 60, "morning", "步行約5分鐘", 2000),
    stop("新宿御苑", "日式、英式、法式三種庭園", 90, "afternoon", "搭地鐵至新宿三丁目", 500),
    stop("歌舞伎町夜景", "東京最繁華的娛樂區，走馬看花", 60, "evening", "步行約10分鐘", 0),
  ], hotel("Shinjuku Granbell Hotel", "新宿區"), meals("表參道 Bills", "新宿中村屋", "新宿 思い出横丁")),

  day(4, "澀谷與台場（住宿資料缺失）", [
    stop("澀谷 SCRAMBLE SQUARE 展望台", "俯瞰澀谷十字路口的最佳位置", 60, "morning", "搭JR至澀谷站", 2000),
    stop("惠比壽花園廣場", "法式廣場風格，咖啡廳林立", 90, "afternoon", "搭JR山手線至惠比壽", 500),
    stop("台場富士電視台", "未來感建築外觀，免費入場展望台", 60, "afternoon", "搭百合海鷗線", 0),
  ], null, meals("澀谷 Eggs'n Things", "代官山 LOG ROAD", "台場 海鮮居酒屋")),

  day(5, "返程日", [
    stop("東急手創館 伴手禮採購", "最後一站購物，設計文具最推薦", 90, "morning", "步行至澀谷站周邊", 3000),
    stop("成田機場 辦理登機", "提早3小時抵達", 30, "afternoon", "搭NEX約55分鐘", 3000),
  ], null, meals("飯店早餐", "機場便當", "—")),
];

// ─── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 確保 demo user 存在
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: { id: DEMO_USER_ID, email: "demo@ai-travel-agent.dev", name: "Demo User" },
  });

  // 清除舊的 seed 資料（避免重複執行堆積）
  const existing = await prisma.itinerary.findMany({
    where: { userId: DEMO_USER_ID },
    select: { id: true, title: true },
  });
  const toDelete = existing.filter(it => it.title.startsWith(SEED_MARKER));
  if (toDelete.length > 0) {
    await prisma.itinerary.deleteMany({
      where: { id: { in: toDelete.map(it => it.id) } },
    });
    console.log(`🗑  清除 ${toDelete.length} 筆舊 seed 資料`);
  }

  const records = [
    {
      label: "Scenario A：5天維也納（F4 AI插入點測試）",
      title: `${SEED_MARKER} [A] 維也納5天行程`,
      days: scenarioA_days,
      cfg: config(5, "VIE", "VIE"),
    },
    {
      label: "Scenario B：維也納→布達佩斯7天（F1 移動日測試）",
      title: `${SEED_MARKER} [B] 維也納→布達佩斯7天`,
      days: scenarioB_days,
      cfg: config(7, "VIE", "BUD"),
    },
    {
      label: "Scenario C：歐洲12天（F5 購物車上限測試）",
      title: `${SEED_MARKER} [C] 歐洲大城市12天滿行程`,
      days: scenarioC_days,
      cfg: config(12, "VIE", "PRG"),
    },
    {
      label: "Scenario D：東京住宿缺失行程（F3 Graceful Degradation測試）",
      title: `${SEED_MARKER} [D] 東京5天（住宿資料缺失）`,
      days: scenarioD_days,
      cfg: config(5, "NRT", "NRT", "JPY"),
    },
  ];

  const results = [];
  for (const r of records) {
    const saved = await prisma.itinerary.create({
      data: {
        userId: DEMO_USER_ID,
        title: r.title,
        days: JSON.stringify(r.days),
        config: r.cfg,
      },
    });
    results.push({ label: r.label, id: saved.id });
    console.log(`✅  ${r.label}`);
    console.log(`    → http://localhost:3000/view/${saved.id}`);
  }

  console.log("\n📋 測試場景總覽：");
  console.log("─".repeat(60));
  for (const r of results) {
    const tag = r.label.match(/Scenario ([A-Z])：/)?.[1] ?? "?";
    console.log(`  Scenario ${tag}  ${r.id}`);
  }
  console.log("\n前往 http://localhost:3000/itineraries 查看所有行程");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
