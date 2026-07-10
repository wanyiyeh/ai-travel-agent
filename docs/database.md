# 資料庫結構

> 對應檔案：[prisma/schema.prisma](../prisma/schema.prisma)
> 最後更新：2026-07-05

- **ORM**：Prisma Client
- **資料庫**：SQLite（連線字串由環境變數 `DATABASE_URL` 提供）

---

## 資料表總覽

| Model | 用途 |
|---|---|
| `User` | 使用者帳號 |
| `Itinerary` | 一份完整行程（含所有天數、景點，以 JSON 字串存放） |
| `Place` | Google Places 查詢結果快取（以 `place_id` 為主鍵） |
| `PlaceQuery` | 查詢字串 → `Place` 的映射，讓同義查詢字串共用同一筆快取 |

---

## User（使用者）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String | 主鍵，UUID 自動生成 |
| `email` | String | 唯一 |
| `name` | String? | 顯示名稱（可選） |
| `createdAt` | DateTime | 建立時間 |
| `updatedAt` | DateTime | 更新時間，自動維護 |
| `itineraries` | Itinerary[] | 反向關聯，該使用者的所有行程 |

**關係**：一對多 → `Itinerary`。

---

## Itinerary（行程）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String | 主鍵，UUID 自動生成 |
| `userId` | String | 外鍵，對應 `User.id`（DB 欄名 `user_id`） |
| `user` | User | 反向關聯到擁有者 |
| `title` | String | 行程標題 |
| `days` | String | **JSON 序列化字串**：整份行程的天數/景點/住宿/交通等結構化資料（對應 `src/lib/schemas.ts` 的 `ItinerarySchema`／`DaySchema`） |
| `config` | String | **JSON 序列化字串**：產生此行程時使用的設定（航班資訊、使用者偏好等） |
| `createdAt` | DateTime | 建立時間 |
| `updatedAt` | DateTime | 更新時間 |

**關係**：多對一 → `User`，`User` 被刪除時連帶刪除（`onDelete: Cascade`）。

**注意**：
- SQLite 沒有原生 `Json` 型別，`days`/`config` 用 `String` 存 JSON 文字，應用層需自行序列化/反序列化。
- [src/lib/db.ts](../src/lib/db.ts) 用 Prisma Client Extension 讓 Next.js app（`src/app/api/v1/**`）讀寫這兩個欄位時自動做 `JSON.parse`/`JSON.stringify`，呼叫端可以直接把 `days` 當物件操作。
- `scripts/*.ts` 各腳本另外自建 `PrismaClient`，**沒有**套用這層擴充，需要手動處理 JSON 轉換。

---

## Place（地點快取）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | String | 主鍵，直接使用 Google Places 的 `place_id`（非自動生成） |
| `name` | String | 地點名稱 |
| `address` | String? | 地址（可選） |
| `lat` | Float? | 緯度（可選） |
| `lng` | Float? | 經度（可選） |
| `rating` | Float? | 評分（可選） |
| `types` | String? | JSON 序列化字串，Google Places 回傳的 `types` 陣列（如 `["restaurant","food"]`） |
| `updatedAt` | DateTime | 最後更新時間 |
| `queries` | PlaceQuery[] | 反向關聯，所有指向此地點的查詢字串 |

**關係**：一對多 → `PlaceQuery`。

---

## PlaceQuery（查詢字串快取索引）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `query` | String | 主鍵，快取用的查詢字串（通常是 `"${景點名稱} ${城市提示}"`） |
| `placeId` | String | 外鍵，對應 `Place.id` |
| `place` | Place | 反向關聯 |
| `cachedAt` | DateTime | 快取建立時間 |

**關係**：多對一 → `Place`。

**設計目的**：同一個地點可能被多種不同查詢字串命中（例如「金門大橋 舊金山」與「Golden Gate Bridge」可能指向同一個 `placeId`），用獨立表把「查詢字串」與「地點資料」拆開，避免重複打 Google Places API。詳見 [docs/lib.md](lib.md) 第 6 節 `placeCache.ts` 的說明，其中也記錄了 cache key 帶城市提示可能造成的誤配對問題。

---

## ERD

```
User
 │
 │ 1:N (Cascade)
 ▼
Itinerary  (days / config 為 JSON 字串，內含天數、景點、住宿等結構化資料)

Place
 │
 │ 1:N
 ▼
PlaceQuery  (query 字串 → 指向同一個 Place，做查詢快取)
```

`Itinerary` 與 `Place`/`PlaceQuery` 之間**沒有 Prisma 層級的外鍵關聯**——景點資料是巢狀存在 `Itinerary.days` 的 JSON 裡（每個 stop 可能帶 `placeId` 欄位），實際比對/快取邏輯由應用層（`src/lib/placeCache.ts`）在讀寫 JSON 時手動處理，schema 本身看不出這條關聯。

---

## 已知落差 / 待整理

1. `days`/`config` 用 String 模擬 JSON 是 SQLite 的限制；若之後換成 PostgreSQL，可改用原生 `Json` 型別並在 Prisma schema 層拿到型別檢查。
2. `Place`/`PlaceQuery` 快取邏輯目前有兩套平行實作：正式流程走 `src/lib/placeCache.ts`，但多支 `scripts/*.ts` 各自手刻了幾乎一樣的 upsert 邏輯（見 [docs/lib.md](lib.md)）。
