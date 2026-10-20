---
status: in-progress      # draft | approved | in-progress | done
branch: plan-001-portfolio-launch
issue: 196
created: 2026-10-20
---

# PLAN-001：作品集上線（Vercel + Neon，符合 Google Maps Platform 條款）

## 目標

以作品集規模公開上線：面試官不用登入就能看到精選範例行程，也能以訪客身分少量生成；登入後額度較多。同時讓資料的儲存與顯示方式符合 Google Maps Platform 條款（[ADR-0004](../adr/0004-google-maps-content-storage.md)），並把每月 Google 費用維持在免費額度內。部署平台見 [ADR-0003](../adr/0003-vercel-and-neon.md)。

## 非目標

- 營利功能：金流、聯盟連結、付費方案、背景工作生成。
- 開放資料來源（Foursquare、OSM）：只預留「地點來源可替換」的介面，不接入。
- 內容審核（Moderation）、自訂網域、JSON 欄位改 `Jsonb`、CD 以外的部署自動化。

## 驗收條件

**Google 條款**
- 資料庫裡的 Google 內容只剩 place ID，以及附有取得時間、未滿 30 天的座標；有一支稽核腳本能檢查全資料庫並回報違規筆數（必須為 0）。
- 路線的時間與距離不再寫入資料庫。
- 顯示 Google 內容的每個畫面都有 Google Maps 出處標示；照片顯示作者並連到 Google Maps 原始頁面。
- Google 查詢失敗或配額用完時，行程頁仍可開啟，顯示我們自己的內容（介紹、時段），缺的欄位有提示。

**成本**
- 用 `usageMeter.ts` 量測：作品集規模（每月約 60 次生成、500 次瀏覽）在各 SKU 的免費額度內。
- 行程頁預設只展開第一天；評分與照片點開才查。
- GCP 每日配額設為使用者決定的每日花費上限。

**部署**
- 正式網址可開；未登入可看公開範例行程（唯讀），也能以訪客身分生成，受訪客額度與 Turnstile 限制；登入後額度較多。
- 訪客與登入使用者的生成都計入全站每日上限；上限用完時畫面明確告知，不產生額外的 Google 費用。
- 限流、全站每日熔斷、同時生成上限在多個實例下仍正確。
- 一次真實生成在函式時間上限內完成，串流沒有被截斷。
- Preview 部署不使用正式資料庫，也不使用正式的付費 key。
- CI 通過；正式環境沒有設定 `MOCK_AI`、`MOCK_PLACES`。
- 低調上線期間，頁面帶 `noindex`，README 沒有網址；公開上線後兩者都改回。

## 邊界情況

- Google 換掉某地點的 place ID，或地點已歇業：顯示「地點資訊需要更新」，不讓整頁失敗。
- 座標過期被刪除後，再打開舊行程：地圖顯示前重新取得座標（Essentials 等級）。
- 生成途中 Google 配額用完：沿用現有的失敗處理，不寫入半成品。
- Neon 冷啟動：閒置後第一個請求較慢，不能因此逾時。
- 遷移前的舊行程：清理腳本執行後，名稱等欄位改為顯示時才查。

## 成本

- 開發期間的驗證優先用 `npm run dev:mock` 與 #182；需要真實 API 時依 `CLAUDE.md` R1 先詢問。
- 上線驗證：真實生成 1～2 次（OpenAI 與 Google 各數十次以內的呼叫）。
- 估算依據：2026-10-03 的 `usageMeter` 實測與 Google 2026-10-16 價目表；任務 A0 會重新量測目前的實際值。

## 設計摘要

**脫水／補水邊界**：程式內部的 `Stop`、`Meal`、`Accommodation` 形狀不變。
- **寫入時脫水**：所有寫入 `Itinerary.days`、候選紀錄、垃圾桶的路徑，都經過同一個函式移除 Google 欄位，只留 place ID、座標與取得時間、我們自己的內容。放在 `src/lib/db.ts` 的 extension（它已經負責 `days` 的 JSON 轉換），所以不會有路徑漏掉。
- **讀取時補水**：API 回傳行程前，只對需要顯示的天數向 Google 查名稱、地址（Pro 等級）；同一請求內合併重複的 place ID，不跨請求快取。評分、照片走「點開才查」的端點。
- **生成與編輯**：同一個請求內照常使用即時的 Google 資料（使用不等於儲存）；編輯流程需要名稱時，先補水該天。

**快取調整**：保留 `PlaceQuery`（查詢字串 → place ID）、`CityCenterMissCache`（確定找不到）。`Place` 表只留 place ID 與座標；`NearbyPlaceCandidatesCache`、`CityPlaceHintsCache` 改成只存 place ID 與座標；`DistanceCache`、`NearestStationCache` 的內容移除。生成成本因此上升，以 #188（Nearby 降到 Pro）抵銷。

**顯示方式**（[ADR-0005](../adr/0005-place-display-hybrid.md)）：行程列表由伺服器補查名稱與地址；點開地點的詳情改用 Google 的 Places UI Kit 元件（評分、照片、營業狀態，出處標示內建）。

**地點來源可替換**：候選池的取得包成介面，之後可以加入開放資料來源。

**部署**：Vercel（Hobby）+ Neon（免費方案），兩者都在新加坡。記憶體裡的限流、熔斷、同時生成鎖改存 Postgres。

## 任務拆解

先做 0，再做 A（資料模型先定案），最後做 B（Postgres 遷移只需做一次）。

**0. 前置**
1. #181 Google 預算通知與硬上限（使用者操作）。
2. #182 `MOCK_AI` 擴充到生成主流程，讓後續驗證免費。
3. #197 確認 OpenAI 組織設定沒有把輸入輸出分享給 OpenAI 訓練（使用者操作）。

**A. Google 條款合規**

4. #198 A0：用 `dev:mock` 重新量測一次生成的 Google 呼叫次數（OpenAI 真實，約 US$0.01，先詢問）。`usageMeter.ts` 的統計除了印 log，也寫進資料庫（Vercel Hobby 的 log 保留很短），上線後才能回頭計算成本。
5. #199 A1：決定顯示方式（自建補水 vs Places UI Kit），確認 UI Kit 的計費單位與樣式限制，結果寫成 ADR。
6. #200 A2：脫水函式與可儲存欄位白名單，接進 `db.ts`；測試確保 Google 欄位寫不進資料庫。
7. #201 A3：補水：行程讀取路徑只補需要的天數；評分、照片點開才查；查詢失敗時降級顯示。
8. #202 A4：行程頁預設只展開第一天，展開時才補水。
9. #203 A5：快取表調整（見設計摘要），以及生成、編輯流程改用同一請求內的即時資料。
10. #204 A6：座標加上取得時間；排程刪除超過 30 天的座標，需要時重新取得。
11. #205 A7：Google Maps 出處標示、照片作者與原始頁面連結。
12. #206 A8：清理遷移腳本：把現有行程、候選紀錄、垃圾桶的 Google 欄位移除，以及稽核腳本。
13. #188 Nearby Search 降到 Pro 欄位。
14. #207 用書面向 Google 詢問灰色地帶：讓 LLM 以地點名稱產生介紹是否違反 3.2.3(c)（使用者送出）。

**B. 部署**

15. #208 B1：SQLite 遷移到 Postgres：provider、建立 migration 基準線、本機與 CI 的測試資料庫（CI workflow 由使用者 push）。
16. #209 B2：限流、全站每日熔斷、同時生成鎖改存 Postgres（沿用 `RateLimitStore` 介面）。
17. #210 B3：量測生成最長時間，設定 `maxDuration`，讓重試與 fallback 落在時間上限內。
18. #211 B4：排程改成 Vercel Cron 路由：清理過期訪客、刪除過期座標。
19. #212 B5：上線前防護：寫入 API 的來源檢查、照片路由的 key 改放 header、審查公開文件中的防護細節。
20. #213 B6：Vercel 與 Neon 設定：
    - Neon 與 Vercel **函式地區**都設在新加坡（Vercel 預設是美國東岸）。
    - 正式與 preview 環境分開，preview 部署保護，preview 不給真實的付費 key。
    - Google OAuth、Maps key、Turnstile 加上正式網域。
    - Vercel 的 GitHub App 只授權這個 repo；Vercel 與 GitHub 帳號開啟兩步驟驗證（使用者操作）。
    - 對照官方文件確認 Hobby 超過額度時的行為，寫進 `docs/runbook.md`。
    - 資料庫 migration 設計成向前相容：Vercel 可以退回上一版程式，但不會退回 migration。
21. #214 B7：低調上線：頁面加上 `noindex`、README 不放網址；上線驗證；在正式環境生成 2～3 份公開範例行程。
22. #215 B8：公開上線（使用者確認檢查完畢後）：拿掉 `noindex`，README 加上網址。

## 已決定

- 訪客（未登入）可以生成，沿用現有的訪客額度（IP、裝置、帳號三層）、Turnstile 與 3 天過期。額度數字參數見 `src/lib/quota.ts`，上線前依 A0 的量測結果確認全站每日上限能讓 Google 費用維持在免費額度內（2026-10-20）。

- 正式環境與本機開發共用同一組 OpenAI 與 Google key，之後可能更換模型或地圖服務，屆時再調整。瀏覽器 Maps key 的網域限制同時允許 `localhost` 與正式網址；GCP 每日配額由兩者共用，設定時預留開發用量，開發驗證優先用 `dev:mock`（2026-10-20）。
- 若之後把地圖換成非 Google 的地圖，地點資料來源也必須一起換掉（服務條款 3.2.3(e)：Google 的地點內容不得顯示在非 Google 地圖上）。

- 每日最高可接受的 Google 花費：US$3（最壞情況約 US$90／月）。GCP 每日配額以請求次數設定，依 A0 量測的呼叫組合、假設免費額度已用完，換算各 API 的每日上限；計算方式寫進 `docs/runbook.md`（2026-10-20）。

- 網域先用 Vercel 的平台子網域（`*.vercel.app`），之後要換自己的網域時，再更新 Google OAuth、Maps key、Turnstile、`AUTH_URL` 四處。分兩階段上線：先低調上線（`noindex`、README 不放網址）檢查，確認沒問題再公開（2026-10-20）。

## 待決定

（無）

## 完成後遷移清單

- [ ] 功能頁：`docs/features/google-content-storage.md`（脫水／補水、快取規則）、`docs/features/deployment.md`
- [ ] ADR：0003、0004、0005 都已 Accepted；完成後確認內容仍符合實作
- [ ] glossary 新詞：脫水、補水
- [ ] `docs/runbook.md`：部署、排程、成本排查
- [ ] `docs/data-sources.md`：Google、OpenAI、Open-Meteo、匯率 API、Neon、Vercel
