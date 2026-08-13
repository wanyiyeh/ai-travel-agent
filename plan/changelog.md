# Changelog

## [feat/trip-preferences] 2026-04-18 — 班機時間 & 行程早中晚規劃

### 新增功能

#### 1. 機票班機時間欄位
- 去程新增「航班抵達時間」（選填，HH:MM）
- 回程新增「航班出發時間」（選填，HH:MM）
- 表單改版：日期與班機時間並排於各自的去程/回程區塊

#### 2. 行程依早中晚分段規劃
- 每個景點標記所屬時段：`morning`（早上）、`afternoon`（下午）、`evening`（晚上）
- 行程卡片依時段顯示分段標題，景點自動歸類
- AI 會合理將每天景點分配至三個時段

#### 3. 景點間交通方式
- 每個景點新增 `transport_from_prev` 欄位
- 描述從上一景點（或住宿、機場）前往的交通方式，例如：「搭乘地鐵約 15 分鐘」
- 行程卡片以箭頭連結形式顯示於景點之間

#### 4. 航班時間約束規劃
- 填寫去程抵達時間時，AI 會讓第 1 天行程在抵達後合理時間才開始（含入境、領行李、前往市區）
- 填寫回程出發時間時，AI 會確保最後一天行程在起飛前至少 3 小時結束

### 修改檔案

| 檔案 | 變更說明 |
|------|----------|
| `src/lib/schemas.ts` | `FlightInfoSchema` 新增 `arrivalTime`、`returnDepartureTime`；`StopSchema` 新增 `time_of_day`、`transport_from_prev` |
| `src/types/itinerary.ts` | `Stop` 型別新增 `time_of_day`、`transport_from_prev` |
| `src/app/page.tsx` | 表單新增兩個 `time` 輸入欄位，`flightInfo` 傳入時間值 |
| `src/app/api/v1/generate-stream/route.ts` | System prompt 加入航班時間限制、早中晚分配規則、交通方式規則；JSON schema 加入新欄位 |
| `src/components/EditableItineraryCard.tsx` | 景點清單依 `time_of_day` 插入時段標題，顯示 `transport_from_prev` 交通連結 |
| `src/components/ViewContent.tsx` | 行程詳情資訊顯示班機抵達/出發時間 |
