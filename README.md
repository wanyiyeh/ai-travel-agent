# AI Travel Agent

以機票為核心的 AI 旅遊行程規劃工具。輸入去回程航班與偏好，產生每天的景點、住宿與三餐；產生後可以拖拉排序、編輯、重新生成單一景點，或用精靈重新規劃城市順序。

> 個人作品集專案。目前低調上線中，正式公開前不放網址。

## 功能

- **從航班開始規劃**：輸入去回程機場與時間，自動算出抵達日、離開日可用的時間，多城市行程會安排移動日的交通。首頁可用代碼、中文、英文搜尋全球約 3,200 個中大型機場（[功能頁](docs/features/airports.md)）。
- **自由文字偏好**：「想看櫻花、不吃牛、帶長輩」這類描述會被解析成結構化偏好，影響景點類型、步調與餐廳篩選。
- **串流生成**：生成過程以 SSE 回傳進度，使用者看得到每個城市的進展。
- **行程編輯**：地圖與列表兩種檢視；景點與午餐、點心、晚餐可在當天拖拉（[功能頁](docs/features/meal-positions.md)）；單一景點換掉、重新挑住宿或餐廳；刪除的東西進垃圾桶，可以復原。
- **重新規劃城市**：插入、移除或調整城市與天數，保留想留的天與必去景點，其餘重新產生（[功能頁](docs/features/transit-days.md)）。
- **帳號與訪客**：Google 登入；未登入也能生成一次，登入時把訪客行程接過來。使用者可自行刪除帳號與所有資料（[功能頁](docs/features/account-deletion.md)）。
- **手機版**：響應式排版，手機上可以完成生成、拖拉與編輯（[功能頁](docs/features/mobile-layout.md)）。

## 設計重點

這個專案大部分的工夫花在「讓 LLM 只做它擅長的事」與「控制外部 API 的成本與條款風險」。

- **規則引擎 + LLM 混合生成**：每天放哪些景點、順序、時段由純函式的規則引擎決定（[`src/lib/scheduler/`](src/lib/scheduler/)），三餐與住宿也由規則從候選池挑選。LLM 只負責解析偏好、決定城市順序與天數、移動日的交通，以及季節亮點、經典一日遊等需要「知識」的建議。結果更穩定、可測試，生成成本也大幅下降。規則引擎失敗時退回舊的「LLM 一次產生整份行程」流程。
- **遵守 Google Maps 服務條款**：資料庫只保存 place ID 與附取得時間的座標，過期自動刪除；送給 LLM 的輸入不放任何 Google 內容，地點文案改用模板（[ADR-0004](docs/adr/0004-google-maps-content-storage.md)、[ADR-0006](docs/adr/0006-coordinate-expiry.md)、[ADR-0008](docs/adr/0008-no-google-content-in-llm-input.md)）。
- **成本防護**：所有計費的 Google 呼叫都經過同一個出口（`src/lib/googleFetch.ts`），可一次換成假資料；花錢的操作有 IP 限流、使用者／裝置額度、全站每日上限、同一 IP 同時只能一個生成，以及 Cloudflare Turnstile 人機驗證。量測方式與實測花費見 [runbook](docs/runbook.md)。
- **提示注入防護**：請求帶來的任何值都只放在 user 訊息並標記為不可信，系統提示只有我們自己的文字（`src/lib/llm.ts`、`src/lib/untrustedInput.ts`）。
- **可免費開發與測試**：`npm run dev:free` 把 Google 與 Claude 都換成假資料；整合測試跑在真的 Postgres 上、不呼叫任何付費 API。

每個「選 A 不選 B」的取捨都記在 [決策紀錄（ADR）](docs/adr/README.md)，例如 [LLM 從 OpenAI 換成 Claude](docs/adr/0012-llm-provider-claude.md)、[機場資料改用開放資料產生](docs/adr/0011-airport-data-from-open-sources.md)。

## 架構

```mermaid
flowchart LR
  U[瀏覽器] -->|"src/proxy.ts：限流、body 上限"| API[src/app/api/v1]
  API --> AUTH[Auth.js / 訪客 cookie<br/>額度、Turnstile]
  API --> LIB[src/lib 商業邏輯]
  LIB --> SCH[src/lib/scheduler<br/>規則引擎]
  LIB --> LLM[llm.ts] --> CL[Claude API]
  LIB --> GF[googleFetch.ts] --> G[Google Places / Routes]
  LIB --> DB[(PostgreSQL)]
```

生成主流程、資料模型與存取控制見 [docs/architecture.md](docs/architecture.md)。

## 技術棧

| 類別 | 使用 |
| --- | --- |
| 框架 | Next.js 16（App Router）、React 19、TypeScript |
| UI | Tailwind CSS、`@dnd-kit`（拖拉）、`@vis.gl/react-google-maps`（地圖） |
| AI | Claude API（Anthropic），模型見 `src/lib/llm.ts`，可用 `LLM_MODEL` 切換 |
| 地點與路線 | Google Places API (New)、Routes API、Places UI Kit |
| 資料庫 | PostgreSQL + Prisma（本機 Docker、正式環境 Neon） |
| 驗證與安全 | Auth.js（Google 登入）、Zod、Cloudflare Turnstile |
| 測試 | Vitest（單元測試 + 真 Postgres 的整合測試） |
| 部署 | Vercel（含每日清理的 Cron）、Neon |
| CI | GitHub Actions：`npm audit`、lint、單元測試、整合測試、build |

外部資料（OurAirports、Wikidata、世界銀行、Open-Meteo、ExchangeRate-API）的用途與出處見 [docs/data-sources.md](docs/data-sources.md)。

## 快速開始

1. 安裝依賴
   ```bash
   npm install
   ```
2. 設定環境變數：把 `.env.example` 複製成 `.env` 後填入自己的值（見下表；Prisma 指令只讀 `.env`）
3. 啟動本機 Postgres（需要先開 Docker Desktop），並套用 migration
   ```bash
   npm run db:up
   npx prisma migrate deploy
   ```
   `docker-compose.yml` 建立三個資料庫：`travel`（`npm run dev`）、`travel_mock`（`dev:mock`、`dev:free`）、`travel_test`（整合測試）。資料存在 Docker volume，`docker compose down -v` 會刪掉。
4. 啟動開發伺服器。想先完全免費地試，用假資料模式：
   ```bash
   npm run dev:free
   ```
   要用真實的 Google 與 Claude（會產生費用）則用 `npm run dev`。開啟 [http://localhost:3000](http://localhost:3000)。

## 環境變數

| 變數 | 必填 | 說明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 連線字串；本機為 `postgresql://travel:travel@localhost:5432/travel` |
| `ANTHROPIC_API_KEY` | 是 | Claude API 金鑰（Claude Console 建立） |
| `LLM_MODEL` | 否 | 預設見 `src/lib/llm.ts` 的 `DEFAULT_LLM_MODEL` |
| `GOOGLE_PLACES_API_KEY` | 是（地點/地圖功能） | Google Places API 金鑰（後端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 是（地圖功能） | Google Maps JS API 金鑰（前端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | 否 | Google Maps Map ID（自訂地圖樣式用） |
| `MOCK_AI` | 否 | `1` 立即回傳假資料、`slow` 模擬 3.5 秒延遲、`error` 模擬失敗。涵蓋整個行程生成流程，沒有 mock 的 Claude 呼叫會被擋下而不是計費（`src/lib/mockAi.ts`）。完全不花錢的開發用 `npm run dev:free` |
| `AUTH_SECRET` | 是（登入） | 簽署登入 session 的密鑰，32 bytes 以上的隨機字串（`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 是（登入） | Google OAuth 用戶端（Google Auth Platform → 用戶端 → 網頁應用程式；重新導向 URI `http://localhost:3000/api/auth/callback/google`） |
| `ADMIN_EMAILS` | 否 | 管理者 Google email，逗號分隔；不受使用額度限制 |
| `MOCK_PLACES` / `MOCK_DATABASE_URL` | 否 | Google 全部用假資料（`npm run dev:mock`、`dev:free` 會自動設定）；資料庫名稱必須含 `mock`。不要在正式環境設定 |
| `CSP_ENFORCE` | 否 | `1` 時 CSP 改成強制執行（預設只回報，#250） |
| `CRON_SECRET` | 正式環境必填 | Vercel Cron 呼叫每日清理（`/api/cron/daily`）時帶的密碼，16 個字元以上的隨機字串。沒設定時這個路由一律拒絕 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 正式環境必填 | Cloudflare Turnstile（生成行程前的人機驗證）。開發環境沒設定時會略過驗證；正式環境沒設定則一律拒絕生成 |

> 兩組 Google key 請分開：前端的 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 會被打包進瀏覽器、人人看得到，只開 Maps JavaScript API 與 Places UI Kit，並限制網域；後端的 `GOOGLE_PLACES_API_KEY` 只開 Places API (New) 與 Routes API。
>
> Google 與 Claude 都有實際費用，量測與排查方式見 [docs/runbook.md](docs/runbook.md)。

## 可用指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 開發伺服器（真實 Google 與 Claude，會產生費用） |
| `npm run dev:mock` | 開發伺服器，Google 全部用假資料（`MOCK_PLACES`、`travel_mock` 資料庫），Claude 仍是真的 |
| `npm run dev:free` | 開發伺服器，Google 與 Claude 都用假資料，完全不花錢 |
| `npm run db:up` | 啟動本機 Postgres（Docker） |
| `npm run build` / `npm run start` | 建置正式版 / 啟動已建置的正式版 |
| `npm run lint` | ESLint 檢查 |
| `npm test` | 單元測試（不碰資料庫） |
| `npm run test:integration` | 整合測試（真 Postgres `travel_test`、假 AI；不可平行跑、不可指向開發資料庫） |
| `npm run seed` | 灌入測試資料（會呼叫 Claude 與 Google Places，會產生費用） |
| `npm run build-airports` | 從 OurAirports、Wikidata、世界銀行重新產生 `src/data/` 的機場與國家資料並印出抽查報告（免費；每年一次，見 ADR-0011） |
| `npm run cleanup-expired-guests` | 手動執行每日清理中的過期訪客、舊使用紀錄與限流資料部分（正式環境由 Vercel Cron 每天執行） |
| `npm run purge-expired-coords` | 刪除過期的 Google 座標（不呼叫任何 API，見 `docs/runbook.md`） |
| `npm run audit-google-content` | 檢查資料庫裡還有沒有不能保存的 Google 內容，有就以狀態碼 1 結束（不改任何資料） |
| `npm run cleanup-google-content` | 移除舊資料裡的 Google 內容；不加 `-- --yes` 只列出會移除什麼（不可逆，先備份，見 `docs/runbook.md`） |
| `npm run copy-sqlite-to-postgres` | 把舊的 SQLite 檔（`prisma/dev.db`、`mock.db`）搬進 `DATABASE_URL` 的 Postgres；不加 `-- <檔案> --yes` 只預覽，可重複執行（見 `docs/runbook.md`） |
| `npm run claim-demo-itineraries` | 一次性：把舊示範使用者的行程轉給第一個 `ADMIN_EMAILS` 帳號，可重複執行 |

評估用的付費腳本（`shadow-compare`、`validate-preference-intent`、`batch-test-rule-engine`、`eval-form-fidelity`）會呼叫真實的 Claude 或 Google，用途寫在各自 `scripts/*.ts` 的開頭註解。

## 專案結構

```
src/
├── app/
│   ├── page.tsx            # 首頁表單（航班 + 偏好）
│   ├── itineraries/        # 已儲存的行程列表
│   ├── view/[id]/          # 行程頁（地圖 / 列表、編輯、垃圾桶）
│   ├── account/、privacy/  # 帳號管理、隱私權說明
│   └── api/
│       ├── v1/             # API 路由（薄薄一層，邏輯在 src/lib/）
│       ├── auth/           # Auth.js
│       └── cron/           # Vercel Cron 每日清理
├── lib/                    # 商業邏輯：生成、Places、快取、驗證、額度
│   ├── scheduler/          # 規則引擎（純函式）
│   └── auth/               # 使用者、訪客、擁有權
├── components/、hooks/     # 前端元件與 React hooks
├── data/                   # 產生出來的機場與國家資料（不手動編輯）
├── types/                  # 共用型別
├── auth.ts                 # Auth.js 設定
└── proxy.ts                # API 限流與 body 大小上限
prisma/                     # schema 與 migrations
scripts/                    # 一次性或批次腳本
tests/                      # 整合測試的 setup 與 mock
docs/                       # 專案文件
```

## 文件

從 [docs/index.md](docs/index.md) 開始：

- [架構](docs/architecture.md) — 系統總覽、生成流程、資料模型
- [功能總覽](docs/features/index.md) — 每個功能現在怎麼運作
- [決策紀錄（ADR）](docs/adr/README.md) — 為什麼選 A 不選 B
- [計畫](docs/plans/README.md) — 各階段功能的規格與任務拆解
- [詞彙表](docs/glossary.md) — 領域詞彙與程式碼識別字的對應
- [Runbook](docs/runbook.md) / [部署](docs/deploy.md) / [資料來源](docs/data-sources.md)

待辦與優先序在 GitHub Issues。

## 開發流程

這個專案和 Claude Code 協作開發：每個功能先寫計畫（`docs/plans/`）、拆成 issue，在獨立分支實作後開 PR，CI 通過才合併。協作規則寫在 [CLAUDE.md](CLAUDE.md) 與 [`.claude/rules/`](.claude/rules/)。
