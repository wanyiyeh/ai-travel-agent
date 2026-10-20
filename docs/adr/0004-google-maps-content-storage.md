# ADR-0004：Google 地點內容只存 place ID 與 30 天內的座標，其他欄位顯示時才查

日期：2026-10-20
狀態：Proposed

## 背景

為了控制 Google 費用，專案長期把 Places 與 Routes 的結果存進資料庫：`Place` 表永久保存名稱、地址、評分、類型、照片名稱；行程、候選紀錄、垃圾桶也存著同樣的欄位；`DistanceCache` 存路線的時間與距離。

Google Maps Platform 條款（2026-10-15 版）規定：
- 服務條款 3.2.3(a)(b)：不得儲存或快取 Google Maps 內容，例如不得複製保存商家名稱、地址；只有特定服務條款明確允許的除外。
- 特定服務條款第 3 條：place ID 可以快取。
- 特定服務條款 14.3、19.3：Places 與 Routes 的座標最多快取 30 天，到期必須刪除；路線時間與距離沒有例外。
- Places 政策：沒有搭配 Google 地圖顯示時要放 Google 標誌；照片要標示作者並提供連到原始頁面的連結。

這些條款在公開上線時就適用，與是否營利無關。

## 決策

- 資料庫只保存 place ID、附取得時間的座標（超過 30 天刪除），以及我們自己產生的內容（LLM 寫的介紹、時段、停留時間、順序）。
- 寫入時在 `src/lib/db.ts` 的邊界統一移除 Google 欄位（脫水）；讀取時只對需要顯示的部分向 Google 查詢（補水），不跨請求快取。
- 畫面預設只展開第一天，評分與照片點開才查，讓作品集規模的費用維持在免費額度內。
- 生成與編輯時，在同一個請求內照常使用即時的 Google 資料。
- 補上 Google Maps 出處標示與照片作者。

## 考慮過的替代方案

- 維持現有快取：成本最低，但違反條款。
- 列表只顯示我們自己的內容、不顯示名稱：規則引擎挑出的地點，名稱來自 Google，存下來同樣違反「不得保存商家名稱」。
- 每次瀏覽查全部欄位、所有天：合規，但每次瀏覽約 US$1，作品集規模也會超出免費額度。
- 改用開放資料（Foursquare、OSM）作為候選來源：名稱可合法儲存，但需要另外解決熱門度與品質；列為營利階段的試做，本決策只預留可替換的介面。
- 顯示改用 Google 的 Places UI Kit：自帶出處標示、單價較低，但樣式受限；由 PLAN-001 任務 A1 評估後另寫 ADR。

## 後果

- 每次瀏覽與每次生成都會產生 Google 費用；作品集規模在免費額度內，流量增加時成本隨之上升，營利前要重新估算。
- 生成無法再靠快取省錢，以 Nearby Search 降到 Pro 欄位（#188）抵銷。
- 遷移時要清理既有資料；本機 `dev.db` 也一樣。
- 灰色地帶尚未確定：讓 LLM 以地點名稱產生介紹，是否屬於 3.2.3(c)「以 Google Maps 內容創作內容」；以書面向 Google 詢問，營利前請專業人士確認。

## 相關

[PLAN-001](../plans/PLAN-001-portfolio-launch.md)、[ADR-0003](0003-vercel-and-neon.md)、`.claude/rules/google-places.md`、[Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms)、[Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)、[Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
