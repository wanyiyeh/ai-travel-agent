# AI Travel Agent — 架構文件

> 最後更新：2026-04-12

---

## 專案概覽

以機票為核心的 AI 旅遊行程規劃工具。使用者輸入來回機票資訊後，AI 自動規劃每日景點與住宿建議，並支援地圖檢視與行程編輯。

**Tech Stack**
- Framework：Next.js 15 (App Router)
- UI：Tailwind CSS
- AI：OpenAI API（`gpt-4o-mini`，可透過 `OPENAI_MODEL` env 切換）
- DB：PostgreSQL + Prisma ORM
- 地圖：`@vis.gl/react-google-maps`
- 拖拉排序：`@dnd-kit`
- 驗證：Zod

---

## 使用者流程

```
輸入機票資訊（出發地、目的地、去回程日期）
  → 輸入旅遊風格描述（選填）+ 偏好設定
  → AI 串流生成行程（含每日住宿建議）
  → 跳轉行程頁（列表 / 地圖切換）
  → 可拖拉排序景點、編輯、刪除、重新生成
```

---

## 檔案結構

```
src/
├── app/
│   ├── page.tsx                         # 首頁表單（機票輸入 + 偏好）
│   ├── itineraries/
│   │   └── page.tsx                     # 已儲存行程列表
│   ├── view/[id]/
│   │   └── page.tsx                     # 行程詳細頁
│   └── api/v1/
│       ├── generate/route.ts            # 非串流生成（未使用，保留備用）
│       ├── generate-stream/route.ts     # 串流生成（主要入口）
│       ├── itinerary/[id]/route.ts      # 取得單一行程
│       └── stops/
│           ├── reorder/route.ts         # 景點排序
│           └── [stopId]/
│               ├── route.ts             # 編輯 / 刪除景點
│               ├── regenerate/route.ts  # AI 重新建議景點
│               └── enrich/route.ts      # Google Places 補充地理資料
├── components/
│   ├── EditableItineraryCard.tsx        # 可編輯行程卡片（含拖拉）
│   ├── ItineraryMap.tsx                 # Google Maps 地圖檢視
│   ├── ViewContent.tsx                  # 行程頁外層容器
│   ├── StreamingPreview.tsx             # 串流生成預覽
│   ├── SortableStop.tsx                 # 單一可排序景點
│   └── StopDragPreview.tsx              # 拖拉時的預覽浮層
├── hooks/
│   └── useStreamingGenerate.ts          # 串流生成 hook（SSE 處理）
├── lib/
│   ├── db.ts                            # Prisma singleton
│   ├── openai.ts                        # OpenAI client
│   └── schemas.ts                       # Zod schemas（共用型別）
└── types/
    └── itinerary.ts                     # TypeScript 型別定義
```

---

## 資料模型

### DB Schema（Prisma）

**Itinerary**
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String (UUID) | 主鍵 |
| `userId` | String | 關聯 User |
| `title` | String | 行程標題 |
| `days` | Json[] | 每日行程（含景點與住宿） |
| `config` | Json | 生成設定（機票資訊、偏好等） |
| `createdAt` | DateTime | 建立時間 |

**`days` JSON 結構**
```json
{
  "id": "uuid",
  "day": 1,
  "theme": "淺草文化巡禮",
  "stops": [
    {
      "id": "uuid",
      "name": "淺草寺",
      "description": "東京最古老的寺廟",
      "duration_minutes": 90,
      "orderIndex": 0,
      "placeId": "ChIJ...",
      "lat": 35.7147,
      "lng": 139.7966,
      "address": "東京都台東區淺草 2-3-1",
      "rating": 4.5,
      "openingHours": "[\"週一: 06:00–17:00\", ...]"
    }
  ],
  "accommodation": {
    "name": "淺草東武ホテル",
    "area": "淺草"
  }
}
```

**`config` JSON 結構**
```json
{
  "generatedWith": "以文化美食為主",
  "totalDays": 5,
  "createdAt": "2026-04-12T00:00:00.000Z",
  "isStreamed": true,
  "flightInfo": {
    "departureCity": "台北",
    "destination": "東京",
    "departureDate": "2026-05-01",
    "returnDate": "2026-05-06"
  },
  "preferences": {
    "pace": "moderate",
    "budget": "moderate",
    "interests": ["food", "culture"]
  }
}
```

---

## Zod Schemas（`src/lib/schemas.ts`）

| Schema | 用途 |
|---|---|
| `FlightInfoSchema` | 機票資訊驗證（出發地、目的地、日期） |
| `TripPreferencesSchema` | 偏好設定（步調、預算、興趣） |
| `AccommodationSchema` | 住宿建議（名稱、區域） |
| `StopSchema` | 景點基本欄位 |
| `DaySchema` | 單日行程（含 stops + accommodation） |
| `ItinerarySchema` | 完整行程（AI 輸出驗證用） |

---

## API 路由

### `POST /api/v1/generate-stream`

串流生成行程，回傳 SSE（Server-Sent Events）。

**Request Body**
```json
{
  "flightInfo": {
    "departureCity": "台北",
    "destination": "東京",
    "departureDate": "2026-05-01",
    "returnDate": "2026-05-06"
  },
  "prompt": "以文化美食為主",
  "preferences": {
    "pace": "moderate",
    "budget": "moderate",
    "interests": ["food", "culture"]
  }
}
```

**SSE 事件類型**
| type | 說明 |
|---|---|
| `chunk` | 中間進度（累積的 JSON 字串） |
| `complete` | 生成完成，含 `data`（行程）與 `id`（DB ID） |
| `error` | 生成失敗 |

---

### `POST /api/v1/stops/[stopId]/enrich`

呼叫 Google Places API，補充景點的地理資料。

- 輸入：`itineraryId`, `context`（搜尋輔助詞）
- 寫回：`placeId`, `lat`, `lng`, `address`, `rating`, `openingHours`

### `POST /api/v1/stops/[stopId]/regenerate`

AI 重新建議一個景點（不重複現有行程中的地點）。

### `PATCH /api/v1/stops/[stopId]`

手動編輯景點（名稱、描述、時長）。

### `DELETE /api/v1/stops/[stopId]`

刪除景點（每天至少保留 1 個）。

### `POST /api/v1/stops/reorder`

更新景點排序，將新的 `stopIds` 順序寫回 DB。

---

## 環境變數

| 變數 | 必填 | 說明 |
|---|---|---|
| `DATABASE_URL` | 是 | PostgreSQL 連線字串 |
| `OPENAI_API_KEY` | 是 | OpenAI API 金鑰 |
| `OPENAI_MODEL` | 否 | 預設 `gpt-4o-mini` |
| `GOOGLE_PLACES_API_KEY` | 是（地圖功能） | Google Places API 金鑰（後端用） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 是（地圖功能） | Google Maps JS API 金鑰（前端用） |

> 兩組 Google key 可以使用同一把，但需在 Google Cloud Console 同時啟用 Maps JavaScript API 和 Places API。

---

## 重要設計決策

### 為何 reorder 需要 API？
行程資料的 source of truth 在 DB（`Itinerary.days` JSON 欄位），前端拖拉後必須同步回 DB，否則重新整理或換裝置後順序會遺失。

### 為何有兩個 generate 路由？
`/generate` 為初期版本（一次回傳），`/generate-stream` 為主要版本（SSE 串流），前端一律使用串流版，`/generate` 目前未被呼叫，保留備用。

### Stop enrich 的時機
AI 生成的景點只有名稱與描述，沒有座標。切換到地圖頁時，對所有尚未有 `lat/lng` 的 stop 呼叫 enrich API，補完地理資料後才能在地圖上顯示 pin。

### Demo User
尚未實作 Auth，所有行程統一存在 `DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"` 下，並透過 `upsert` 確保該 user 存在。
