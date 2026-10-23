# AI Travel Agent

以機票資訊為核心的 AI 旅遊行程規劃工具。輸入去回程航班與偏好後，AI 串流生成每日景點、住宿與三餐建議，並可在地圖 / 列表檢視中拖拉排序、編輯、刪除、重新生成，或插入中途城市。

## Tech Stack

- **Framework**：Next.js 16 (App Router)
- **UI**：Tailwind CSS
- **AI**：OpenAI API（預設 `gpt-4o-mini`，可用 `OPENAI_MODEL` 切換）
- **DB**：PostgreSQL + Prisma ORM（本機用 Docker，正式環境用 Neon）
- **地圖**：`@vis.gl/react-google-maps`
- **地點資料**：Google Places API（Text Search / Place Details / Photos）
- **拖拉排序**：`@dnd-kit`
- **驗證**：Zod

## 快速開始

1. 安裝依賴
   ```bash
   npm install
   ```
2. 設定環境變數（見下表），建立 `.env.local`
3. 啟動本機 Postgres（需要先開 Docker Desktop），並套用 migration
   ```bash
   npm run db:up
   npx prisma migrate deploy
   ```
   `docker-compose.yml` 建立三個資料庫：`travel`（`npm run dev`）、`travel_mock`（`dev:mock`、`dev:free`）、`travel_test`（整合測試）。資料存在 Docker volume，`docker compose down -v` 會刪掉。
4. （選用）灌入測試資料——會實際呼叫 OpenAI 與 Google Places，會產生費用
   ```bash
   npm run seed
   ```
5. 啟動開發伺服器
   ```bash
   npm run dev
   ```
   開啟 [http://localhost:3000](http://localhost:3000)

## 環境變數

| 變數 | 必填 | 說明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 連線字串；本機為 `postgresql://travel:travel@localhost:5432/travel` |
| `OPENAI_API_KEY` | 是 | OpenAI API 金鑰 |
| `OPENAI_MODEL` | 否 | 預設 `gpt-4o-mini` |
| `GOOGLE_PLACES_API_KEY` | 是（地點/地圖功能） | Google Places API 金鑰（後端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 是（地圖功能） | Google Maps JS API 金鑰（前端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | 否 | Google Maps Map ID（自訂地圖樣式用） |
| `MOCK_AI` | 否 | `1` 立即回傳假資料、`slow` 模擬 3.5 秒延遲、`error` 模擬失敗。涵蓋整個行程生成流程，沒有 mock 的 OpenAI 呼叫會被擋下而不是計費（`src/lib/mockAi.ts`）。完全不花錢的開發用 `npm run dev:free` |
| `AUTH_SECRET` | 是（登入） | 簽署登入 session 的密鑰，32 bytes 以上的隨機字串（`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 是（登入） | Google OAuth 用戶端（Google Auth Platform → 用戶端 → 網頁應用程式；重新導向 URI `http://localhost:3000/api/auth/callback/google`） |
| `ADMIN_EMAILS` | 否 | 管理者 Google email，逗號分隔；不受使用額度限制 |
| `CRON_SECRET` | 正式環境必填 | Vercel Cron 呼叫每日清理（`/api/cron/daily`）時帶的密碼，16 個字元以上的隨機字串。沒設定時這個路由一律拒絕 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 正式環境必填 | Cloudflare Turnstile（生成行程前的人機驗證）。開發環境沒設定時會略過驗證；正式環境沒設定則一律拒絕生成 |

> 兩組 Google key 請分開：前端的 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 會被打包進瀏覽器、人人看得到，只開 Maps JavaScript API 與 Places UI Kit，並限制網域；後端的 `GOOGLE_PLACES_API_KEY` 只開 Places API (New) 與 Routes API。目前的防護整理在 [plan/security-hardening.md](plan/security-hardening.md)。
>
> Google Places API 有實際費用，開發時建議留意用量（可參考 [plan/google-api-cost-spike-2026-07.md](plan/google-api-cost-spike-2026-07.md) 記錄過的踩雷經驗）。

## 可用指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動開發伺服器（真實 Google 與 OpenAI，會產生費用） |
| `npm run dev:mock` | 開發伺服器，Google 全部用假資料（`MOCK_PLACES`、`travel_mock` 資料庫），OpenAI 仍是真的 |
| `npm run dev:free` | 開發伺服器，Google 與 OpenAI 都用假資料，完全不花錢 |
| `npm run build` | 建置正式版 |
| `npm run start` | 啟動已建置的正式版 |
| `npm run lint` | ESLint 檢查 |
| `npm run seed` | 灌入測試資料 |
| `npm run purge-expired-coords` | 刪除超過 30 天的 Google 座標（不呼叫任何 API，見 `docs/runbook.md`） |
| `npm run audit-google-content` | 檢查資料庫裡還有沒有不能保存的 Google 內容，有就以狀態碼 1 結束（不改任何資料） |
| `npm run copy-sqlite-to-postgres` | 把舊的 SQLite 檔（`prisma/dev.db`、`mock.db`）搬進 `DATABASE_URL` 的 Postgres；不加 `-- <檔案> --yes` 只預覽，可重複執行（見 `docs/runbook.md`） |
| `npm run cleanup-google-content` | 移除舊資料裡的 Google 內容；不加 `-- --yes` 只列出會移除什麼（不可逆，先備份，見 `docs/runbook.md`） |

## 專案結構

```
src/
├── app/
│   ├── page.tsx              # 首頁表單（機票輸入 + 偏好）
│   ├── itineraries/          # 已儲存行程列表
│   ├── view/[id]/            # 行程詳細頁（含地圖 / 垃圾桶）
│   └── api/v1/                # API 路由（行程生成、景點/住宿/餐廳編輯、地點快取）
├── components/                # UI 元件（行程卡片、地圖、拖拉排序、各類 picker）
├── hooks/                      # React hooks（串流生成等）
├── lib/                        # Prisma client、OpenAI client、Google Places 整合、Zod schemas
└── types/                      # TypeScript 型別定義
```

## 文件

更完整的架構、資料庫 schema、元件與 API 說明在 [`docs/`](docs/) 資料夾：

- [architecture.md](docs/architecture.md) — 整體架構與使用者流程
- [database.md](docs/database.md) — Prisma schema 說明
- [api-overview.md](docs/api-overview.md) — 各 API 路由與依賴
- [components.md](docs/components.md) / [hooks.md](docs/hooks.md) / [lib.md](docs/lib.md) — 前端元件、hooks、共用邏輯
- [google-apis.md](docs/google-apis.md) / [google-places-types.md](docs/google-places-types.md) — Google Places/Maps 整合細節
- [scripts-analysis.md](docs/scripts-analysis.md) — `scripts/` 各工具腳本用途
