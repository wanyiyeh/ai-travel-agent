# Scripts 目錄分析筆記

---

## 1. `check-east-coast.mjs` — 北美東岸行程深度驗證工具

### 用途
從資料庫撈出所有標題含「北美東岸」的行程，逐筆印出完整內容並執行多項品質驗證。

### 執行方式
```bash
node scripts/check-east-coast.mjs
```

### 流程
1. **讀取 `.env`** — 手動解析 `.env` 檔案注入環境變數（因 Next.js 不會在純 node 環境注入）
2. **查詢 DB** — `prisma.itinerary.findMany({ where: { title: { contains: "北美東岸" } } })`
3. **逐天印出**：主題、住宿名稱/區域、每個景點（時段、時長、費用、交通）、三餐
4. **執行五項驗證**：

| 驗證項目 | 條件 | 輸出 |
|---|---|---|
| 每日超時 | 當天所有景點 duration 加總 > 720 分鐘（12 小時）| `⚠ Day N 景點總時長 Xmin 超出 12 小時` |
| 重複景點 | 同一景點名稱出現在多天 | `⚠ 重複景點「X」出現在 Day A 和 Day B` |
| 重複餐廳 | 同一餐廳名稱出現在多天/多餐 | `⚠ 重複餐廳「X」...` |
| 移動日缺漏 | 多城市行程（arrivalCity ≠ returnDepartureCity）但無 isTransitDay | `⚠ 多城市行程但缺少移動日` |
| 住宿缺漏 | 非最後一天、非移動日，但沒有 accommodation | `⚠ Day N 缺少住宿` |

5. **住宿序列印出** — 列出所有非移動日的住宿名稱與區域，方便目視確認地理方向性

### 注意事項
- 只適用於「北美東岸」行程，其他地區需另外寫腳本
- 是唯讀工具，不會修改資料庫
- 依賴 Prisma 連線，需確保 `DATABASE_URL` 在 `.env` 中設定正確

---

## 2. `check-perth.mjs` — 大洋洲行程快速檢視工具

### 用途
快速印出資料庫中第一筆「大洋洲」行程的基本結構，做初步人工確認。

### 執行方式
```bash
node scripts/check-perth.mjs
```

### 流程
1. **查詢 DB** — `findFirst({ where: { title: { contains: "大洋洲" } } })`，只取第一筆
2. **印出基本資訊**：標題、總天數
3. **移動日統計** — 列出 `isTransitDay === true` 的天數及數量
4. **每日主題列表** — Day 1 ~ Day N 的 `theme` 欄位
5. **住宿概覽** — 每天住宿狀態，並標示三種合理情況：
   - 有住宿：印出名稱與區域
   - 回程日（最後一天）無住宿：標 `✅`
   - 移動日無住宿：標 `✅`
   - 其餘無住宿：標 `⚠`
6. **重複餐廳檢查** — 收集全部行程三餐名稱，找出重複的並顯示
7. **所有景點列表** — 按 Day 印出每個景點的時段與名稱

### 與 check-east-coast.mjs 的差異
| 面向 | check-east-coast | check-perth |
|---|---|---|
| 目標行程 | 北美東岸（多筆） | 大洋洲（第一筆）|
| 驗證深度 | 完整（5 項驗證 + 住宿序列）| 輕量（快速目視確認）|
| 費用資訊 | 印出每個景點費用 | 不印費用 |
| 環境變數 | 手動讀取 .env | 依賴 Prisma 預設（無手動讀取）|

### 注意事項
- 只取 `findFirst`，若有多筆大洋洲行程只會看到第一筆
- 適合產完 seed 後快速確認結構，不適合做全面 QA

---

## 3. `seed-test-data.ts` — AI 驅動的行程種子資料產生器

### 用途
透過 OpenAI 生成橫跨 9 大洲區的示範行程，並可選擇性地用 Google Places API 擴充座標、評分、地址等真實資料，最後寫入資料庫供開發/測試使用。

### 執行方式
```bash
npm run seed               # 產生全部 9 個地區
npm run seed 亞洲          # 只產生符合篩選條件的地區
npm run seed 北美東岸      # 支援中文或英文關鍵字
```

### 9 個 Scenario 一覽
| 地區 | 路線 | 天數 | 預算 | 主題 |
|---|---|---|---|---|
| 亞洲 | 東京 → 大阪 | 7 天 | moderate | 文化、美食 |
| 歐洲西歐 | 巴黎 → 阿姆斯特丹 | 14 天 | moderate | 文化、購物 |
| 歐洲東歐 | 維也納 → 布拉格 | 12 天 | budget | 文化、美食 |
| 歐洲北歐 | 斯德哥爾摩 → 哥本哈根 | 14 天 | luxury | 自然、文化 |
| 英國 | 倫敦 → 愛丁堡 | 12 天 | moderate | 文化、美食 |
| 大洋洲 | 伯斯 → 墨爾本 | 12 天 | moderate | 自然、美食 |
| 北美東岸 | 紐約 → 邁阿密 | 15 天 | moderate | 文化、美食、購物 |
| 北美西岸 | 洛杉磯 → 舊金山 | 12 天 | moderate | 文化、自然、美食 |
| 非洲 | 開普敦 → 約翰尼斯堡 | 14 天 | moderate | 自然、冒險 |

所有路線皆採 **open-jaw**（不同城市進出）設計。

### 主要流程

```
1. 讀取 .env
2. Upsert Demo User（固定 UUID: 00000000-0000-0000-0000-000000000001）
3. 清除同地區舊 seed 資料（識別標記：[TEST-SEED]）
4. 對每個 scenario：
   a. 向 Google Places 取得真實餐廳清單 → 注入 system prompt
   b. 呼叫 OpenAI (gpt-4o-mini / OPENAI_MODEL 環境變數) 產生 JSON 行程
   c. 執行三段修復（transit day 修復、移動日補充、住宿缺漏補充）
   d. validateItinerary 驗證，部分錯誤觸發 retry（最多 3 次）
   e. 用 Google Places Text Search 為每個景點補充 placeId / 座標 / 地址 / 評分
   f. 寫入 prisma.itinerary
5. 印出總覽結果
```

### 關鍵函式說明
| 函式 | 位置 | 功能 |
|---|---|---|
| `generateItinerary` | 本檔案 | 呼叫 OpenAI，含 retry 邏輯 |
| `repairMissingAccommodation` | 本檔案 | 缺住宿時往前找最近一天的住宿沿用 |
| `addIds` | 本檔案 | 為每天、每個景點加上 `randomUUID()` |
| `enrichDaysWithPlaces` | 本檔案 | 呼叫 Google Places Text Search，跳過交通接駁類景點 |
| `buildSystemPrompt` | `src/lib/itineraryGen.ts` | 組出 OpenAI system prompt |
| `repairTransitDayDepartureCities` | `src/lib/itineraryGen.ts` | 修正移動日的出發城市欄位 |
| `repairMissingTransitDay` | `src/lib/itineraryGen.ts` | 若 AI 忘記生成移動日則補充 |
| `tagWaypointCities` | `src/lib/itineraryGen.ts` | 為每天標記所在城市 |
| `validateItinerary` | `src/lib/validateItinerary.ts` | 驗證行程結構，回傳 issues 陣列 |
| `fetchCityRestaurants` | `src/lib/fetchCityRestaurants.ts` | 從 Google Places 取得城市餐廳清單 |

### Retry 策略
只有以下驗證錯誤碼才會觸發 retry，其餘接受或由修復函式處理：
- `DAY_COUNT_MISMATCH` — 天數與預期不符
- `DAY_NUMBER_SEQUENCE` — Day 編號不連續
- `DAY_TOO_FEW_STOPS` — 景點太少（最後一天除外）
- `TRANSIT_DAY_MISSING` — 多城市行程缺移動日
- `TRANSIT_DAY_TOO_LATE` — 移動日位置太晚
- `TRANSIT_DAY_INVALID_POSITION` — 移動日位置不合理

### 環境變數需求
| 變數 | 必填 | 說明 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | 缺少時腳本直接報錯退出 |
| `OPENAI_MODEL` | 選填 | 預設 `gpt-4o-mini` |
| `GOOGLE_PLACES_API_KEY` | 選填 | 缺少時跳過餐廳注入與景點擴充 |
| `DATABASE_URL` | ✅ | Prisma 連線用，通常已在 .env |

### 注意事項
- Google Places enrichment 有 150ms 間隔（避免觸發 rate limit），景點多的行程需要較長時間
- seed 資料以 `[TEST-SEED]` 為標記，重新執行會先刪除同地區舊資料再重建
- Demo User ID 固定不變，方便跨次 seed 維持一致性
- 使用 `tsx` 或 `ts-node` 執行（因為是 `.ts` 檔且 import 了專案內部模組）
