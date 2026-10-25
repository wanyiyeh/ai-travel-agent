# ADR-0008：LLM 的輸入不放任何 Google Maps 內容，Google 地點的文案改用模板

日期：2026-10-25
狀態：Accepted

## 背景

Google Maps Platform 服務條款 3.2.3(c) 禁止「以 Google Maps 內容創作內容」。[ADR-0004](0004-google-maps-content-storage.md) 把「讓 LLM 以 Google 的地點名稱寫介紹」列為灰色地帶，原本打算以書面詢問 Google（#207）。

盤點後，把 Google 內容交給 LLM 的地方不只寫介紹：

- 生成時寫景點文案（`src/lib/skeletonCopy.ts`）、補寫缺少的介紹（`src/lib/missingCopy.ts`）
- 編輯時的加景點、景點建議、重新生成餐廳與住宿
- 用 LLM 翻譯 Google 的店名（`src/lib/translatePlaceNames.ts`）
- 景點建議把當天的 Google 名稱當成排除清單交給 LLM
- 舊的整段生成 fallback 把 Google 餐廳名稱放進 prompt（`src/lib/itineraryGen.ts` 的 `restaurantHintsPrompt`）

Google 的回覆時間與結論都無法掌握，作品集公開前需要確定合規。

## 決策

- **LLM 的輸入不放任何 Google Maps 內容**：名稱、地址、評分、類型、評論都不放。可以放的只有我們自己的資料：使用者偏好、規則引擎為哪個主題送出的查詢、時段、停留時間、與前後地點的安排、城市名稱（使用者輸入或 LLM 自己提出的）。
- 地點仍由 Google 候選池與規則引擎挑選，不改成由 LLM 提出名稱。
- Google 地點的文案不再由 LLM 寫，改用模板，只用我們自己的安排資料：主題日的第一站寫「今天的〇〇從這裡開始」、整天行程的最後一站寫「今天的最後一站」，其他站留白。畫面本來就顯示名稱、停留時間與交通方式；地點本身的介紹交給「照片與詳情」（Places UI Kit），由 Google 自己顯示。
- 不用從 Google 類型轉換來的分類（寺社、博物館等）寫文案：那仍是由 Google 內容衍生，而且會跟著文案存進資料庫。
- 程式原本就會寫的實用說明（「一日遊：從東京搭火車約 1 小時到鎌倉」「在鎌倉吃午餐」）是我們自己的內容，照舊保留。
- 不再用 LLM 翻譯店名，顯示 Google 以 `zh-TW` 回傳的名稱。
- 同一地點、不同名稱的判斷（`partOf`）不再交給 LLM；改用什麼方式由 PLAN-002 決定。
- 使用者自己輸入的文字（固定行程、手動輸入的景點、重新規劃的必去景點）不是 Google 內容，可以照常交給 LLM。

## 考慮過的替代方案

- 以書面詢問 Google（#207）：回覆時間與結論都不確定，可能拖住公開；就算得到口頭同意，條款沒改也不一定算數。
- 景點改由 LLM 憑自己的知識提出名稱，Google 只確認存在（#226）：名稱與介紹都是我們自己的內容，但 LLM 容易編造或記錯地點，景點品質不可控。
- LLM 只拿安排資料（時段、停留時間、順序）寫「為什麼安排這裡」：條款上乾淨，但這些資料畫面上都已顯示，句子會重複又彼此相似，花 OpenAI 費用卻沒有增加資訊。
- LLM 另外拿從 Google 類型轉換來的粗分類（寺社、博物館）：文案較有內容，但仍由 Google 內容衍生並存下來；分類錯時文案跟著錯，LLM 看不到名稱也無從發現。若之後營利，存下的文案越多越難清理。
- 景點候選改用開放資料（Wikidata／Wikipedia），LLM 依條目寫介紹：沒有幻覺也能寫地點特色，但要新接資料源、處理熱門度與配對；列入 #227 之後評估。

## 後果

- 列表上大多數站沒有文案；需要地點特色的使用者要點「照片與詳情」，每次打開 Places UI Kit 計費一次。
- 生成少了每一天的文案呼叫，OpenAI 費用與生成時間都下降。
- 營利前若要讓文案寫出地點特色，改用有授權的內容（Google 自己的摘要欄位、開放資料或授權資料，#227），不讓 LLM 依 Google 的資料寫。
- 新增任何 OpenAI 呼叫點時，輸入不可包含 Google 回傳的欄位；以守門測試把關（PLAN-002）。
- Google 沒有中文名稱的店會顯示原文（與 #185 相關）。
- 既有行程裡用舊作法寫的介紹要清掉（#270）。
- 灰色地帶不再存在，#207 以 not planned 關閉。

## 相關

[PLAN-002](../plans/PLAN-002-llm-without-google-content.md)、[ADR-0004](0004-google-maps-content-storage.md)、[ADR-0005](0005-place-display-hybrid.md)、#207、#226、#227、`.claude/rules/google-places.md`
