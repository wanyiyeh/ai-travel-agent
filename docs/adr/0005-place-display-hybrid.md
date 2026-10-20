# ADR-0005：列表由伺服器補查名稱與地址，地點詳情改用 Google 的 Places UI Kit

日期：2026-10-20
狀態：Accepted

## 背景

依 [ADR-0004](0004-google-maps-content-storage.md)，資料庫只存 place ID 與 30 天內的座標，名稱、地址、評分、照片要在顯示時才向 Google 取得。有兩種取得方式：

- **伺服器補查**：用 Places API (New) 的 Place Details 查欄位，畫面照我們自己的設計呈現，出處標示自己做。
- **Places UI Kit**：Google 在瀏覽器裡畫好的元件，給 place ID 就顯示名稱、地址、評分、類型、價位、營業狀態、照片，出處標示內建。

查證的官方文件（2026-10-20 版）：

| | 伺服器補查 | Places UI Kit |
| --- | --- | --- |
| 計費 | 依請求的最高欄位等級（名稱、地址為 Pro；評分為 Enterprise；照片另計） | 每建立一個元件計費一次（Places UI Kit Query），與顯示哪些欄位無關 |
| 價格與每月免費額度 | 見 [Google 價目表](https://developers.google.com/maps/billing-and-pricing/pricing) | 同左；單價約為 Place Details Pro 的 1/17 |
| 外觀 | 完全自訂 | 固定版面，只能改顏色、字型、圓角與寬度 |
| 出處標示 | 自己做 | 內建，且不可移除 |
| 我們的程式能否讀到名稱 | 可以 | 不行（只在元件內顯示） |
| 狀態 | 正式版 | 實驗階段（pre-GA），官方說明支援有限、可能不相容 |
| 未說明的事 | — | React 重新渲染是否重複計費；一頁放多個元件的行為 |

## 決策

混合使用：

- **行程列表**（每個景點、餐點、住宿那一列）：伺服器補查名稱與地址（Pro 等級），只補需要顯示的天數（PLAN-001 #201、#202）。外觀、拖拉排序、列印維持現狀。
- **地點詳情**（點開某個地點時）：改用 Places UI Kit 的 Place Details 元件，顯示評分、照片、營業狀態等。一次只顯示一個。
- 地圖上的資訊視窗也可以使用同一個元件。

## 考慮過的替代方案

- **全部伺服器補查**：外觀不變、最穩定，但詳情的評分（Enterprise）與照片每次都較貴，出處標示與照片作者要全部自己做。
- **全部用 Places UI Kit**：最便宜，出處標示全內建；但我們的程式讀不到名稱（地圖標記、導航連結、候選紀錄、垃圾桶、重新規劃精靈都要改），每一列變成「我們的內容 + Google 卡片」，外觀不一致；整頁依賴實驗功能；重新渲染是否重複計費未知，費用可能失控；列印效果未知。

## 後果

- 實驗功能的風險只限於詳情面板；若 Google 變更造成問題，詳情面板退回伺服器補查即可。
- 伺服器端的編輯流程（給 LLM 的當天地點名稱）照樣在同一請求內向 Google 查，不受影響。
- 列表顯示 Google 的名稱與地址，沒有搭配地圖的地方要放 Google Maps 標示（#205）；詳情面板的標示與照片作者由元件處理。
- 瀏覽器用的 Maps key 要多開啟 Places UI Kit（#213）。
- 實作詳情面板前，先用 Google 的免費 Demo Key 確認重新渲染與計費的行為。
- 列表不再顯示照片縮圖；照片只在詳情面板出現。

## 相關

[PLAN-001](../plans/PLAN-001-portfolio-launch.md)、#199、#201、#202、#205、#213、[ADR-0004](0004-google-maps-content-storage.md)、[Places UI Kit 概覽](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview)、[Places 政策](https://developers.google.com/maps/documentation/javascript/policies)
