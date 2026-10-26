# ADR-0009：移動日的交通留在 stops 裡、標記成交通站，早餐改由規則挑選

日期：2026-10-26
狀態：Accepted

## 背景

移動日由 `planTransitDay`（`src/lib/itineraryCityGen.ts`）請 LLM 寫「出發準備」（`prepStops`，通常是早餐）與「交通本身」（`transitStop`），兩者都存成一般的 stop，沒有 placeId 也沒有座標（#286）。正式環境的一筆開普敦 → 赫曼努斯行程因此出現：

- 交通與早餐可以拖拉、換成別的地點；使用者想調整順序時，交通也跟著被移動
- 重新計算交通是一站接一站算的，相鄰的站沒有座標，就顯示「交通方式未知（缺少座標）」，一天三段
- 早餐是可拖拉的 stop，`meals` 裡卻沒有早餐，跟其他天的餐點長得像、行為卻不同
- 補資料時拿「搭乘自駕車前往赫曼努斯」這種文字去查 Google，白花錢，還可能配上錯的地點

## 決策

- **交通仍放在 `stops` 裡，加上 `kind: "transit"`**。畫面上顯示成交通列，本身不能拖拉、換地點、移到別天或刪除，也不佔景點編號。
- **其他景點可以拖到交通的前面或後面**：交通前面是出發城市的行程，後面是抵達城市的行程。不強制所有景點都在交通之後，否則已經排錯的舊行程改不回來，出發前在出發城市逛一站也是合理的安排。
- 重新計算交通時，交通站保留 LLM 寫的車程；它後面第一站寫「抵達〇〇後出發」，不再出現「缺少座標」。
- 補資料（`enrich-all-stops`）跳過交通站，不拿交通的文字查 Google。
- **移動日的早餐改成 `meals.breakfast`**，由規則從出發城市的早餐候選挑選（`src/lib/mealLodgingPicks.ts`），跟其他天一樣。出發城市多挑一天的餐點，只取那天的早餐，不多查 Google。
- **`planTransitDay` 不再產生 `prepStops`**，只回傳交通與抵達時間。prepStops 是 LLM 自己寫的名稱，沒有座標也無法放上地圖；出發前的早晨改由早餐填上。
- 舊行程不轉換資料：讀取時把「移動日裡沒有 placeId、不是固定行程、名稱含『前往』」的 stop 視為交通站（`src/lib/transitStop.ts`）。

## 考慮過的替代方案

- 交通移出 `stops`，改存成 day 上獨立的 `transitLeg`：資料結構比較乾淨，但要改型別、`placeStorage` 白名單、所有讀寫 stops 的路由與畫面，舊行程也要轉換。改動量與風險都大，換來的只是結構上比較好看。
- 景點不能跨過交通：已經把抵達城市景點排在交通前面的舊行程就修不好。
- 保留 prepStops 中的「快速景點」：沒有座標，交通一樣算不出來；要補座標就得拿 LLM 的名稱去查 Google，會多花錢。

## 後果

- `Stop` 多一個 `kind` 欄位，已加進 `src/lib/placeStorage.ts` 的 `STOP_FIELDS`。
- 會處理 stops 的地方要用 `isTransitStop` 跳過交通站：畫面、重新計算交通、補資料、批次編輯的可重用景點。之後新增處理 stops 的功能也要考慮它。
- 移動日早上不再有出發城市的小景點，只有早餐。
- 舊行程的辨認規則是推測，可能漏判；漏判的會跟以前一樣，被當成一般的 stop。
- 規則引擎失敗時的整段 LLM 備援（`generateTransitDayStopsWithLLM`）仍會寫早餐與交通，交通靠形狀辨認。
- 重新規劃（restructure）產生的移動日仍沒有任何餐點（#290）。

## 相關

- issue：#286、#288
- 程式碼：`src/lib/transitStop.ts`、`src/lib/itineraryCityGen.ts`（`planTransitDay`、`generateMealsAndAccommodation`）、`src/lib/assembleItineraryDays.ts`、`src/app/api/v1/days/[dayId]/recalculate-transport/route.ts`、`src/app/api/v1/itinerary/[id]/enrich-all-stops/route.ts`、`src/components/TransitLegRow.tsx`
- [ADR-0008](0008-no-google-content-in-llm-input.md)
