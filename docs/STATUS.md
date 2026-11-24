# STATUS

更新：2026-11-24

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

README 已改成作品集導向（功能、設計重點、架構圖、技術棧），修正過期的技術棧、專案結構與文件連結（PR #360 已合併）。正式網址與截圖等 #215 正式公開再加。

[PLAN-006](plans/PLAN-006-mobile-layout.md)（`done`，父 issue #344）：手機版（響應式網頁）已完成，現在怎麼運作見[功能頁](features/mobile-layout.md)。2026-11-24 最後一輪截圖（375／430／1280px、淺色與深色）都沒有水平捲軸，使用者也用手機在正式網站驗收過（公開範例、生成、拖拉、換景點、地圖）。平板與橫向手機沒有專屬排版（#358，known-limitation）。本機截圖時另外建了資料庫 `travel_mock_mobile`（`MOCK_DATABASE_URL` 指向它，測試瀏覽器帶不同的 `x-forwarded-for` 當作另一位本機訪客，避開本機訪客名額），只有假資料，可以留著或刪掉。`dev:free` 第一次啟動常被 Next.js 的版本提醒中止，再啟動一次就會繼續（#332）。

[PLAN-005](plans/PLAN-005-llm-to-claude-haiku.md)（`done`，父 issue #333 在 PR #341 合併時關閉）：LLM 從 OpenAI 換成 Claude Haiku 5.5（[ADR-0012](adr/0012-llm-provider-claude.md)）。所有呼叫經過 `src/lib/llm.ts`，`openai` 已移除；請求帶來的值不進系統提示（R7，`tripPlan.ts` 與舊流程另見 #342）。#340 已用真實 Claude 驗收（`dev:mock`）：規則引擎每次生成約 US$0.001～0.002、舊流程約 US$0.005，內容合理，數字在 [runbook](runbook.md)。PR #341 已合併（2026-11-22）；合併前已對 Neon 的 `travel`、`travel_mock` 跑 `migrate deploy`，Vercel Production 已設 `ANTHROPIC_API_KEY`（到期日以 Claude Console 的 API Keys 頁為準）。開發用 key 在本機 `.env` 的 `ANTHROPIC_API_KEY`。本機 Git Bash 跑 `npm test` 會全部失敗（磁碟代號大小寫），改用 PowerShell；用 curl 送中文要寫成 UTF-8 檔案再 `--data-binary @檔案`，直接放在參數裡會變亂碼。

[PLAN-004](plans/PLAN-004-itinerary-chat.md) 行程聊天助理：2026-11-24 與使用者討論完 v1 範圍，計畫已確認（`in-progress`，父 issue #367，子 issue #368～#374，分支 `plan-004-itinerary-chat`）。ADR-0013（伺服器分類與授權）、ADR-0014（聊天取代精靈）已 `Accepted`。#368 已完成：`ChatMessage`、`ChatProposal` 資料表與 migration（本機已套用），三條刪除路徑靠外鍵連帶刪除，有整合測試。正式 Neon 的 `migrate deploy` 等 PR #375 合併前再跑。定位是「這趟行程的旅遊顧問」，分三階段：v1（問行程、提案再確認的修改、聊天版重新規劃、伺服器分類後授權、`chat` 額度）、v1.5 接 Google 的 Maps Experience agent tools（#363）、v2 接網路搜尋（#364）。精靈在聊天版驗收後才刪（#365）。對話紀錄只存回覆文字、不回送思考區塊（ADR-0012）。討論中發現 `transport_from_prev` 保存了由 Routes 時間產生的文字，可能不符 ADR-0004（#362）。

修正朋友測試正式網站時回報的編輯問題（開普敦 → 赫曼努斯行程）。#286 已完成（PR #291）：移動日的交通改成交通站、早餐改由規則挑選（[ADR-0009](adr/0009-transit-leg-as-pinned-stop.md)）。#287、#292 已完成（PR #293）：午餐、點心、晚餐可在當天拖拉，餐點可以刪除與加回（[ADR-0010](adr/0010-draggable-meals.md)、[功能頁](features/meal-positions.md)）。#288 已完成：行程上方加一行說明哪些可以拖。#290 已完成：重新規劃產生的移動日也有餐點（只用這次本來就查的候選，缺的留空位）。朋友另外反映找不到冰島的機場：已補上 KEF（雷克雅維克）與 ISK 物價。

[PLAN-003](plans/PLAN-003-any-airport.md)（`done`，父 issue #300，PR #308 已合併）：機場改用開放資料（OurAirports、Wikidata、世界銀行）產生，涵蓋約 3,200 個中大型機場，人工清單優先（[ADR-0011](adr/0011-airport-data-from-open-sources.md)、[功能頁](features/airports.md)）。首頁選單可用代碼、中文、英文搜尋全部機場；交通時間依距離估算；新貨幣依物價水準估價。世界銀行、Open-Meteo、ExchangeRate-API 的出處標在 `/privacy#data-sources`（頁尾有連結），後兩者另外在行程頁顯示資料的地方附連結（#307）；外部資料來源整理在 [data-sources.md](data-sources.md)，每年更新步驟在 [runbook](runbook.md)。

[PLAN-002](plans/PLAN-002-llm-without-google-content.md) 已完成（父 issue #262，PR #273）：OpenAI 的輸入不再放任何 Google 內容，避開服務條款 3.2.3(c) 的灰色地帶（[ADR-0008](adr/0008-no-google-content-in-llm-input.md)，取代向 Google 書面詢問的 #207）。Google 地點的文案改用模板、大多數站留白；三餐與住宿改由規則挑選；`partOf` 改用 Google 的 `containingPlaces`。現在怎麼運作見[功能頁](features/place-copy-and-meals.md)。2026-10-26 使用者以 `dev:free` 生成一次，畫面正常。本機與正式資料庫的舊文案都已清除（#270）；Neon 的備份 branch `backup-before-270` 會在 2026-11-02 自動刪除。

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線仍在進行（父 issue #196）。已部署到 Vercel（低調上線期間網址不寫進 repo）、Neon 新加坡；設定見 [deploy.md](deploy.md)。#214 只剩訪客生成一次、生成 2～3 份公開範例。

量測結果：Google 一次生成約 US$0.24～0.41（2026-10-23）；Claude 見上（2026-11-22，Google 為假資料）。

## 下一步

1. 正式網站已用 Claude 生成成功（2026-11-22，雪梨 7 天）。剩使用者操作：移除 Vercel 的 `OPENAI_API_KEY`、撤銷 OpenAI 的 key、關閉 #47（升級 `openai`）。`.github/workflows/ci.yml` 裡沒用到的 `OPENAI_API_KEY` 是假字串、不影響 CI，等下次改 CI 設定時由使用者順手刪（token 不能改 workflow）。
2. #332 把 Next.js 升到 16.4.6，可能解決本機 build 與 dev server 被版本安全檢查擋下的問題；本機開發用的 Anthropic key 在 Claude Console 顯示 2 月 22 日到期，到期後本機生成會失敗。
3. #181 剩三件（使用者操作）：確認「My gmail」通知管道的實際地址、Gmail 搜尋以前的預算警示寄到哪、#214 時實際收到一次通知。預算提醒已連結自己的 email；Maps 的硬上限是每日配額（Google 新的支出上限不支援 Maps）。換成 Claude 後，Anthropic Console 的支出上限與「不用 API 資料訓練」要由使用者確認（`/privacy` 已依商業條款這樣寫）。
4. [PLAN-004](plans/PLAN-004-itinerary-chat.md)：下一個是 #369 聊天 LLM 模組（分類、各類別的輸出 schema、名稱比對、`MOCK_AI`）。v1.5 的前提：使用者在 Anthropic Console 確認不以 API 資料訓練（#363）。#214 的公開範例（會花錢，先問），之後 #215 正式公開。#261：由使用者在 Google Cloud 的 OAuth 同意畫面填上正式網址的 `/privacy`。
5. 朋友冰島行程的 issue 都已合併；#295 剩下的情況仍是已知限制。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限（#213、#255）。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）。
- 子地點判斷的公園類、獨立目的地類型清單只以 8 組實測決定（`placeCandidatesToStopCandidates.ts`）；中英文名稱各一筆的重複抓不到（#272）。
- 開發前要先開 Docker Desktop 並 `npm run db:up`。
- 手動測試 `dev:free`：`TURNSTILE_SECRET_KEY="" npm run dev:free` 略過人機驗證；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。本機 `npm run build` 會被 Next.js 版本的安全檢查擋下（編譯與產生頁面都成功，CI 的 build 與 `npm audit` 通過）。
- 重新規劃時，原本沒有移動日的地方產生的移動日仍有空的餐點（#295，known-limitation）；插入新城市的情況已用被換掉的移動日補上。
