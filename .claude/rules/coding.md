---
paths:
  - "src/**/*"
  - "prisma/**/*"
  - "scripts/**/*"
  - "tests/**/*"
  - "*.config.ts"
  - "*.config.mts"
  - "*.config.mjs"
---

# 技術棧細節與程式碼規範

## 技術棧

- **框架**：Next.js 16 App Router + React 19 + TypeScript。Next 16 的 middleware 叫 `src/proxy.ts`（限流、body 上限、device cookie）。
- **AI**：OpenAI（`src/lib/openai.ts`，模型由 `OPENAI_MODEL` 決定）。
- **地點與路線**：Google Places API (New)、Routes API，全部經過 `src/lib/googleFetch.ts`（見 `.claude/rules/google-places.md`）。
- **登入**：Auth.js（`src/auth.ts`），只有 Google 登入、JWT session；未登入的訪客由簽章 cookie 識別（`src/lib/auth/guest.ts`），登入時認領訪客行程。額度在 `src/lib/quota.ts`、用量在 `UsageEvent`；生成前有 Cloudflare Turnstile（`src/lib/turnstile.ts`）。
- **驗證**：Zod（`src/lib/schemas.ts`）；**拖拉**：`@dnd-kit`；**地圖**：`@vis.gl/react-google-maps`。
- **套件管理**：npm。

## 資料庫

- Prisma + PostgreSQL（本機 `docker-compose.yml`，正式 Neon，ADR-0003、ADR-0007）。`Itinerary.days`、`Itinerary.config` 仍存成 JSON 字串（從 SQLite 沿用）；`src/lib/db.ts` 的 Prisma extension 在讀寫時自動 `JSON.parse`/`stringify`，所以 `src/app/api/v1/**` 把它們當物件用。
- **`scripts/*.ts` 不用這個 client**：它們在 Next.js 模組圖之外，各自 `new PrismaClient()`，要自己 `JSON.parse`/`stringify`。在 script 和 route 之間搬邏輯時要注意。
- 改 `schema.prisma` 後跑 `npx prisma migrate dev --name <slug>`，把產生的 `prisma/migrations/` 一起 commit；不要用 `db push`。
- 原生 SQL 的資料表名稱要加雙引號（`"Itinerary"`）：Postgres 會把沒加引號的名稱轉成小寫。
- `MOCK_PLACES=1` 時，`db.ts` 在載入時檢查 `DATABASE_URL` 必須含 "mock"，避免假地點寫進開發資料庫。

## 測試

- 單元測試（`src/**/*.test.ts`，不含 `*.integration.test.ts`）是封閉的，不碰真 DB；限流、生成鎖、每日上限用記憶體版本（`SHARED_STATE=memory`，`src/lib/sharedState.ts`）。兩種版本共用 `tests/contracts/sharedState.ts` 的行為測試。
- 整合測試（`src/**/*.integration.test.ts`）跑在真 Postgres `travel_test`（`tests/integration/global-setup.ts` 每次用 migration 重建），`MOCK_AI=1`，`fileParallelism: false`。不可平行執行，不可指向開發資料庫。需要 Docker 的 Postgres 在跑。
- 有 `playwright` 套件，但沒有設定檔也沒有 E2E 測試，不要假設存在。
- 修 bug 先寫一個修改前會失敗的測試。

## 已知陷阱

- `src/lib/openai.ts` 在 **import 時**就會因為沒有 `OPENAI_API_KEY` 而拋錯；一個 route 即使不呼叫 OpenAI，只要間接 import 到它，就會在載入時失敗。
- `MOCK_AI` 有兩層：幾個編輯路由在呼叫模型前就回傳 `MOCK_FIXTURES`；生成流程的每個呼叫點用 `mockCompletion()` 依輸入產生假回應，後面的解析照常執行。其餘沒有 mock 的呼叫會被 `openai.ts` 擋下（回傳錯誤，不計費），包括舊的整段 LLM fallback。**新增 OpenAI 呼叫點時，同時在 `mockAi.ts` 加上它的假回應**。會寫快取的 AI 結果（季節亮點、經典一日遊、影劇作品）在 mock 模式下不讀也不寫快取。
- 生成主流程是規則引擎（`src/lib/scheduler/`）排骨架、LLM 寫文案（`assembleItineraryDays.ts` → `itineraryCityGen.ts`）；這條路徑失敗時，`generate-stream/route.ts` 會退回舊的「一次串流整份行程」流程（prompt 在 `itineraryGen.ts`），所以舊流程不是死程式碼，不能刪。

## 程式碼規範

- 註解專業、簡潔，用英文，解釋「為什麼」，不用表情符號。
- 新的判斷規則、門檻寫成具名常數，放在使用它的模組最上方，文件引用該常數。
- 機場與城市座標只加在 `src/lib/airports.ts` 的 `AIRPORTS` 表。
