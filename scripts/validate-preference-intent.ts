/**
 * Phase 1 acceptance check from plan/hybrid-rule-engine-scheduling.md:
 * "`parsePreferenceIntent` 對 10-20 組常見自由文字輸入的解析結果人工抽查合理".
 *
 * Runs parsePreferenceIntent() against a fixed set of representative
 * free-text preference blurbs (single-signal, multi-signal, neutral,
 * contradictory, English, edge cases) and prints input/output side by side
 * for human review. Makes real OpenAI calls (small, cheap — short prompts on
 * the default gpt-4o-mini), no DB access.
 *
 * Run: npx tsx scripts/validate-preference-intent.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  // \r?\n split + trim: this repo's .env has CRLF line endings, which broke
  // the anchored $ in other scripts' copy of this same snippet for quoted
  // values (silently masked there because PrismaClient auto-loads .env on
  // its own; not masked here since process.env.OPENAI_API_KEY is read directly).
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)="?([^"]*?)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// 18 samples spanning: single-signal, multi-signal, neutral/no-signal,
// contradictory, English, and edge cases (very short / very long).
const SAMPLES: string[] = [
  "想放鬆一點、晚點出門、想吃在地小吃",
  "想早點出門，行程排滿一點，多看點歷史建築",
  "我吃素，想避開人擠人的地方",
  "喜歡逛街購物，晚上想去體驗一下當地夜生活",
  "想看美術館和建築，步調不要太趕",
  "不吃海鮮，其他都可以",
  "我們家有小孩，走太多路會累，想避開長時間排隊",
  "沒有特別的想法，都可以",
  "早起怕來不及，想睡晚一點再出發，行程也不要太滿",
  "喜歡大自然，想去健行或看風景，不想逛博物館",
  "halal food only please, and I prefer a relaxed pace",
  "I want to wake up early and pack the itinerary as much as possible",
  "想吃很多當地美食，但不吃辣，也不想排隊排太久",
  "gluten free，還有想避開太早的行程",
  "喜歡藝術和建築，晚一點出發沒關係，步調悠閒就好",
  "",
  "早上七點就要出門，行程越多越好，晚上想去酒吧",
  "想體驗當地文化，避免觀光客很多的地方，飲食不吃牛肉",
];

async function main() {
  // Dynamic import: static imports are hoisted above the .env loading above,
  // and src/lib/openai.ts throws at import time if OPENAI_API_KEY isn't set
  // yet (see CLAUDE.local.md's "known sharp edges" note).
  const { parsePreferenceIntent } = await import("../src/lib/preferenceIntent");

  console.log(`=== Phase 1 parsePreferenceIntent 人工抽查（model=${MODEL}） ===\n`);

  for (const [i, text] of SAMPLES.entries()) {
    const result = await parsePreferenceIntent(text, MODEL);
    console.log(`[${i + 1}] 輸入: ${text ? `「${text}」` : "(空字串)"}`);
    console.log(`    解析結果: ${JSON.stringify(result)}`);
    console.log("");
  }

  console.log(`共 ${SAMPLES.length} 組，請人工檢查每組輸出是否合理。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
