# Prisma Schema 分析文件

## 概覽

- **ORM**: Prisma Client JS
- **資料庫**: SQLite（透過環境變數 `DATABASE_URL` 設定連線）

---

## 資料模型

### User（使用者）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | String | 主鍵，UUID 自動生成 |
| `email` | String | 唯一，用於身份識別 |
| `name` | String? | 可選的顯示名稱 |
| `createdAt` | DateTime | 建立時間，自動填入 |
| `updatedAt` | DateTime | 更新時間，自動維護 |
| `itineraries` | Itinerary[] | 關聯到該使用者的所有行程 |

**關係**：一個 User 可擁有多個 Itinerary（一對多）。

---

### Itinerary（行程）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | String | 主鍵，UUID 自動生成 |
| `userId` | String | 外鍵，對應 User.id（DB 欄名：`user_id`） |
| `user` | User | 反向關聯到擁有者 |
| `title` | String | 行程標題 |
| `days` | String | 行程天數相關資料（JSON 序列化字串） |
| `config` | String | 行程設定（JSON 序列化字串） |
| `stops` | Stop[] | 此行程包含的所有景點站 |
| `createdAt` | DateTime | 建立時間 |
| `updatedAt` | DateTime | 更新時間 |

**關係**：
- 屬於一個 User（多對一），User 刪除時連帶刪除（`onDelete: Cascade`）
- 擁有多個 Stop（一對多）

**注意**：`days` 與 `config` 欄位為 String 型別，實際存放 JSON 字串，表示 SQLite 不直接支援 JSON 欄位型別，需在應用層手動序列化/反序列化。

---

### Stop（景點站）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | String | 主鍵，CUID 自動生成 |
| `itineraryId` | String | 外鍵，對應 Itinerary.id（DB 欄名：`itinerary_id`） |
| `itinerary` | Itinerary | 反向關聯到所屬行程 |
| `dayIndex` | Int | 所屬第幾天（DB 欄名：`day_index`） |
| `orderIndex` | Int | 當天的排序順序（DB 欄名：`order_index`） |
| `name` | String | 景點名稱 |
| `description` | String? | 景點描述（可選） |
| `durationMinutes` | Int? | 停留時間（分鐘，可選，DB 欄名：`duration_minutes`） |
| `placeId` | String? | Google Places API 的 place_id（可選，DB 欄名：`place_id`） |
| `lat` | Float? | 緯度（可選） |
| `lng` | Float? | 經度（可選） |
| `address` | String? | 地址（可選） |
| `rating` | Float? | 評分（可選） |
| `openingHours` | String? | 營業時間（可選，DB 欄名：`opening_hours`） |
| `createdAt` | DateTime | 建立時間 |
| `updatedAt` | DateTime | 更新時間 |

**關係**：屬於一個 Itinerary（多對一），Itinerary 刪除時連帶刪除（`onDelete: Cascade`）。

**注意**：Stop 使用 CUID（`@default(cuid())`），其餘模型使用 UUID，兩者皆為不可猜測的唯一識別碼，差異在生成演算法不同。

---

### Place（地點快取）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | String | 主鍵（對應 Google Places place_id，手動設定） |
| `name` | String | 地點名稱 |
| `address` | String? | 地址（可選） |
| `location` | String? | 座標或位置描述（可選） |
| `rating` | Float? | 評分（可選） |
| `userRatings` | Int? | 評分人數（可選） |
| `photoRef` | String? | 照片參考 ID（可選） |
| `updatedAt` | DateTime | 最後更新時間 |

**關係**：Place 目前與其他模型**無明確的 Prisma 關聯**，為獨立快取表。`id` 直接使用 Google Places 的 `place_id` 作為主鍵，方便以 place_id 快取 API 查詢結果，避免重複呼叫外部 API。

---

## 實體關係圖（ERD）

```
User
 │
 │ 1:N (Cascade)
 ▼
Itinerary
 │
 │ 1:N (Cascade)
 ▼
Stop ──(place_id)──► Place（無 Prisma 外鍵，應用層查詢）
```

---

## 設計觀察與潛在改進

| 項目 | 現況 | 說明 |
|------|------|------|
| `days` / `config` 欄位 | JSON 字串 | SQLite 限制，切換 PostgreSQL 可改用 `Json` 型別並獲得型別安全 |
| `Place` 與 `Stop` 的關聯 | 應用層維護 | 可在 schema 中加入 `placeId Stop? @relation(...)` 以強化完整性 |
| `openingHours` | 字串 | 儲存的格式（純文字 vs JSON 陣列）需在應用層一致處理 |
| `location` (Place) | 字串 | 若需要地理查詢，可拆分為 `lat`/`lng` Float 欄位（與 Stop 一致） |
| ID 策略不一致 | Stop 用 CUID，其餘用 UUID | 建議統一為 UUID 或 CUID，減少認知負擔 |
