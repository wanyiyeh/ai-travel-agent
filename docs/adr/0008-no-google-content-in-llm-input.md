# ADR-0008：LLM 的輸入不放任何 Google Maps 內容，文案改寫「為什麼安排這裡」

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
- 每個 Google 地點的文案改寫「為什麼這個行程安排它」，不寫「這個地方本身怎麼樣」；地點本身的介紹交給「照片與詳情」（Places UI Kit），由 Google 自己顯示。
- 文案先用 LLM 寫；之後再評估改用模板。
- 不再用 LLM 翻譯店名，顯示 Google 以 `zh-TW` 回傳的名稱。
- 同一地點、不同名稱的判斷（`partOf`）不再交給 LLM；改用什麼方式由 PLAN-002 決定。
- 使用者自己輸入的文字（固定行程、手動輸入的景點、重新規劃的必去景點）不是 Google 內容，可以照常交給 LLM。

## 考慮過的替代方案

- 以書面詢問 Google（#207）：回覆時間與結論都不確定，可能拖住公開；就算得到口頭同意，條款沒改也不一定算數。
- 景點改由 LLM 憑自己的知識提出名稱，Google 只確認存在（#226）：名稱與介紹都是我們自己的內容，但 LLM 容易編造或記錯地點，景點品質不可控。
- 完全不寫文案，只顯示時段與停留時間：最乾淨，但作品集看不到 AI 的價值。
- 景點候選改用開放資料（Wikidata／Wikipedia），LLM 依條目寫介紹：沒有幻覺也能寫地點特色，但要新接資料源、處理熱門度與配對；列入 #227 之後評估。

## 後果

- 列表的文案講不出地點特色，只能說明安排的理由；需要特色的使用者要點「照片與詳情」，每次打開 Places UI Kit 計費一次。
- 新增任何 OpenAI 呼叫點時，輸入不可包含 Google 回傳的欄位；以守門測試把關（PLAN-002）。
- Google 沒有中文名稱的店會顯示原文（與 #185 相關）。
- 既有行程裡用舊作法寫的介紹要清掉（#270）。
- 灰色地帶不再存在，#207 以 not planned 關閉。

## 相關

[PLAN-002](../plans/PLAN-002-llm-without-google-content.md)、[ADR-0004](0004-google-maps-content-storage.md)、[ADR-0005](0005-place-display-hybrid.md)、#207、#226、#227、`.claude/rules/google-places.md`
