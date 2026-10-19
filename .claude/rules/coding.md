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

- Prisma + SQLite。SQLite 沒有 `Json` 型別，`Itinerary.days`、`Itinerary.config` 存成 JSON 字串；`src/lib/db.ts` 的 Prisma extension 在讀寫時自動 `JSON.parse`/`stringify`，所以 `src/app/api/v1/**` 把它們當物件用。
- **`scripts/*.ts` 不用這個 client**：它們在 Next.js 模組圖之外，各自 `new PrismaClient()`，要自己 `JSON.parse`/`stringify`。在 script 和 route 之間搬邏輯時要注意。
- 改 `schema.prisma` 後跑 `npx prisma db push`。
- `MOCK_PLACES=1` 時，`db.ts` 在載入時檢查 `DATABASE_URL` 必須含 "mock"，避免假地點寫進 `dev.db`。

## 測試

- 單元測試（`src/**/*.test.ts`，不含 `*.integration.test.ts`）是封閉的，不碰真 DB。
- 整合測試（`src/**/*.integration.test.ts`）跑在真 SQLite `prisma/test.db`（由 `tests/integration/global-setup.ts` 建立），`MOCK_AI=1`，`fileParallelism: false`。不可平行執行，不可指向 `dev.db`。
- 有 `playwright` 套件，但沒有設定檔也沒有 E2E 測試，不要假設存在。
- 修 bug 先寫一個修改前會失敗的測試。

## 已知陷阱

- `src/lib/openai.ts` 在 **import 時**就會因為沒有 `OPENAI_API_KEY` 而拋錯；一個 route 即使不呼叫 OpenAI，只要間接 import 到它，就會在載入時失敗。
- `MOCK_AI` 不是全域的：只有 `src/lib/mockAi.ts` 被接上的幾個路由會看它（`grep -rl MOCK_AI src/app` 可列出）。主流程 `generate-stream` 一律打真的 OpenAI。
- `validateGeography.ts` 的同日距離檢查，在 `scripts/check-place-data.ts` 裡還有一份手抄的版本，兩者沒有統一。
- 生成主流程是規則引擎（`src/lib/scheduler/`）排骨架、LLM 寫文案（`assembleItineraryDays.ts` → `itineraryCityGen.ts`）；這條路徑失敗時，`generate-stream/route.ts` 會退回舊的「一次串流整份行程」流程（prompt 在 `itineraryGen.ts`），所以舊流程不是死程式碼，不能刪。

## 程式碼規範

- 註解專業、簡潔，用英文，解釋「為什麼」，不用表情符號。
- 新的判斷規則、門檻寫成具名常數，放在使用它的模組最上方，文件引用該常數。
- 機場與城市座標只加在 `src/lib/airports.ts` 的 `AIRPORTS` 表。
