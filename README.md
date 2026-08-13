# AI Travel Agent

以機票資訊為核心的 AI 旅遊行程規劃工具。輸入去回程航班與偏好後，AI 串流生成每日景點、住宿與三餐建議，並可在地圖 / 列表檢視中拖拉排序、編輯、刪除、重新生成，或插入中途城市。

## Tech Stack

- **Framework**：Next.js 16 (App Router)
- **UI**：Tailwind CSS
- **AI**：OpenAI API（預設 `gpt-4o-mini`，可用 `OPENAI_MODEL` 切換）
- **DB**：SQLite + Prisma ORM
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
3. 建立本地 DB
   ```bash
   npx prisma db push
   ```
4. （選用）灌入測試資料
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
| `DATABASE_URL` | 是 | SQLite 連線字串（例：`file:./dev.db`） |
| `OPENAI_API_KEY` | 是 | OpenAI API 金鑰 |
| `OPENAI_MODEL` | 否 | 預設 `gpt-4o-mini` |
| `GOOGLE_PLACES_API_KEY` | 是（地點/地圖功能） | Google Places API 金鑰（後端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 是（地圖功能） | Google Maps JS API 金鑰（前端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | 否 | Google Maps Map ID（自訂地圖樣式用） |
| `MOCK_AI` | 否 | `1` 立即回傳假資料、`slow` 模擬 3.5 秒延遲、`error` 模擬失敗，供部分 AI 路由在不打真實 API 的情況下測試 UI（不是全域生效，細節見 [docs/lib.md](docs/lib.md)） |

> 兩組 Google key 可使用同一把，但需在 Google Cloud Console 同時啟用 Maps JavaScript API 和 Places API。
>
> Google Places API 有實際費用，開發時建議留意用量（可參考 [plan/google-api-cost-spike-2026-07.md](plan/google-api-cost-spike-2026-07.md) 記錄過的踩雷經驗）。

## 可用指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動開發伺服器 |
| `npm run build` | 建置正式版 |
| `npm run start` | 啟動已建置的正式版 |
| `npm run lint` | ESLint 檢查 |
| `npm run seed` | 灌入測試資料 |
| `npm run backfill-places` | 補齊尚未快取的地點資料 |
| `npm run enrich-all` | 批次補齊行程中缺座標的景點（`--backfill-photos --photo-limit=N` 可額外補照片，opt-in） |
| `npm run check-places` | 檢查地點資料完整性 |

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
