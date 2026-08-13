import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.itinerary.findMany({
    where: { title: { contains: "北美東岸" } },
    select: { id: true, title: true, config: true, days: true },
  });

  console.log(`找到 ${rows.length} 筆北美東岸行程\n`);

  for (const r of rows) {
    console.log("═".repeat(80));
    console.log("ID:", r.id);
    console.log("標題:", r.title);
    const config = JSON.parse(r.config);
    console.log("航班:", config.flightInfo?.arrivalCity, "→", config.flightInfo?.returnDepartureCity);
    console.log("日期:", config.flightInfo?.departureDate, "~", config.flightInfo?.returnDate);
    console.log("偏好:", JSON.stringify(config.preferences));
    console.log("貨幣:", config.currency);
    console.log();

    const days = JSON.parse(r.days);
    console.log(`天數：${days.length} 天\n`);

    let totalWarnings = [];

    for (const d of days) {
      const transitInfo = d.isTransitDay ? ` [移動日→${d.transitTo}]` : "";
      const acc = d.accommodation
        ? `${d.accommodation.name} (${d.accommodation.area})`
        : "null（無住宿）";
      console.log(`--- Day ${d.day}${transitInfo}: ${d.theme} ---`);
      console.log(`  住宿: ${acc}`);

      const stops = d.stops || [];
      let dayTotal = 0;
      for (const s of stops) {
        const dur = s.duration_minutes ?? 0;
        dayTotal += dur;
        console.log(
          `  [${s.time_of_day?.padEnd(9)}] ${s.name} (${dur}min, $${s.estimated_cost ?? "?"} ${config.currency ?? "USD"}) - ${s.transport_from_prev ?? "N/A"}`
        );
      }

      if (dayTotal > 720) {
        const warn = `⚠ Day ${d.day} 景點總時長 ${dayTotal}min (${(dayTotal/60).toFixed(1)}h) 超出 12 小時`;
        console.log("  " + warn);
        totalWarnings.push(warn);
      }

      if (d.meals) {
        const { breakfast, lunch, dinner, snack } = d.meals;
        const fmtMeal = (m) => m ? `${m.name} $${m.estimated_cost}` : "N/A";
        console.log(`  早餐: ${fmtMeal(breakfast)}`);
        console.log(`  午餐: ${fmtMeal(lunch)}`);
        console.log(`  點心: ${fmtMeal(snack)}`);
        console.log(`  晚餐: ${fmtMeal(dinner)}`);
      }
      console.log();
    }

    // 重複景點檢查
    const seenStops = new Map();
    for (const d of days) {
      for (const s of (d.stops || [])) {
        const key = (s.name || "").trim();
        if (!key) continue;
        if (seenStops.has(key)) {
          const warn = `⚠ 重複景點「${key}」出現在 Day ${seenStops.get(key)} 和 Day ${d.day}`;
          totalWarnings.push(warn);
        } else {
          seenStops.set(key, d.day);
        }
      }
    }

    // 重複餐廳檢查
    const seenRestaurants = new Map();
    for (const d of days) {
      if (!d.meals) continue;
      for (const [mealType, meal] of Object.entries(d.meals)) {
        if (!meal?.name) continue;
        const key = meal.name.trim();
        if (seenRestaurants.has(key)) {
          const warn = `⚠ 重複餐廳「${key}」出現在 Day ${seenRestaurants.get(key)} 和 Day ${d.day} (${mealType})`;
          totalWarnings.push(warn);
        } else {
          seenRestaurants.set(key, `${d.day} (${mealType})`);
        }
      }
    }

    // 移動日檢查
    const isMultiCity = config.flightInfo?.arrivalCity !== config.flightInfo?.returnDepartureCity;
    if (isMultiCity) {
      const transitDays = days.filter((d) => d.isTransitDay);
      if (transitDays.length === 0) {
        totalWarnings.push("⚠ 多城市行程但缺少移動日 (isTransitDay)");
      } else {
        console.log(`移動日：Day ${transitDays.map((d) => d.day).join(", ")}`);
      }
    }

    // 住宿缺漏檢查（非最後一天、非移動日）
    const lastDay = days.length;
    for (const d of days) {
      if (d.day === lastDay || d.isTransitDay) continue;
      if (!d.accommodation) {
        totalWarnings.push(`⚠ Day ${d.day} 缺少住宿`);
      }
    }

    // 住宿方向性檢查（沿線移動）
    const nonTransitDays = days.filter((d) => !d.isTransitDay && d.accommodation);
    const accomAreas = nonTransitDays.map((d) => ({
      day: d.day,
      area: d.accommodation.area,
      name: d.accommodation.name,
    }));
    console.log("\n住宿序列：");
    for (const a of accomAreas) {
      console.log(`  Day ${a.day}: ${a.name} (${a.area})`);
    }

    console.log("\n驗證摘要：");
    if (totalWarnings.length === 0) {
      console.log("  ✅ 無明顯問題");
    } else {
      for (const w of totalWarnings) console.log("  " + w);
    }
    console.log();
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
