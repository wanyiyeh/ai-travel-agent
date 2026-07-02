import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const it = await prisma.itinerary.findFirst({ where: { title: { contains: "大洋洲" } } });
const days = JSON.parse(it.days);

console.log("標題:", it.title);
console.log("總天數:", days.length);

const transitDays = days.filter((d) => d.isTransitDay);
console.log("移動日數量:", transitDays.length, transitDays.length === 0 ? "(單城市行程，正確)" : "");
transitDays.forEach((d) => console.log("  移動日在第", d.day, "天"));

console.log("\n每日主題:");
days.forEach((d) => console.log(`  Day${d.day}: ${d.theme ?? "(無)"}`));

console.log("\n住宿概覽:");
days.forEach((d) => {
  const acc = d.accommodation;
  if (acc) console.log(`  Day${d.day} - ${acc.name} | ${acc.area}`);
  else if (d.day === days.length) console.log(`  Day${d.day} - (回程日，無住宿) ✅`);
  else if (d.isTransitDay) console.log(`  Day${d.day} - (移動日，無住宿) ✅`);
  else console.log(`  Day${d.day} - ⚠ 無住宿`);
});

const allRestaurants = [];
days.forEach((d) => {
  if (d.meals?.breakfast) allRestaurants.push(d.meals.breakfast.name);
  if (d.meals?.lunch) allRestaurants.push(d.meals.lunch.name);
  if (d.meals?.dinner) allRestaurants.push(d.meals.dinner.name);
});
const duplicates = [...new Set(allRestaurants.filter((r, i) => allRestaurants.indexOf(r) !== i))];
if (duplicates.length > 0) console.log("\n⚠ 重複餐廳:", duplicates.join(", "));
else console.log("\n✅ 無重複餐廳");

console.log("\n景點概覽:");
days.forEach((d) => {
  d.stops?.forEach((s) => console.log(`  Day${d.day} [${s.time_of_day}] ${s.name}`));
});

await prisma.$disconnect();
