# STATUS

更新：2026-10-26

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

修正朋友測試正式網站時回報的編輯問題（開普敦 → 赫曼努斯行程）。#286 已完成（PR #291）：移動日的交通改成交通站、早餐改由規則挑選（[ADR-0009](adr/0009-transit-leg-as-pinned-stop.md)、[功能頁](features/transit-days.md)）。#289「拖不到最後」用 Playwright 量測後確認是晚餐固定在最後，已併入 #287。

[PLAN-002](plans/PLAN-002-llm-without-google-content.md) 已完成（父 issue #262，PR #273）：OpenAI 的輸入不再放任何 Google 內容，避開服務條款 3.2.3(c) 的灰色地帶（[ADR-0008](adr/0008-no-google-content-in-llm-input.md)，取代向 Google 書面詢問的 #207）。Google 地點的文案改用模板、大多數站留白；三餐與住宿改由規則挑選；`partOf` 改用 Google 的 `containingPlaces`。現在怎麼運作見[功能頁](features/place-copy-and-meals.md)。2026-10-26 使用者以 `dev:free` 生成一次，畫面正常。本機與正式資料庫的舊文案都已清除（#270）；Neon 的備份 branch `backup-before-270` 會在 2026-11-02 自動刪除。

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線仍在進行（父 issue #196）。已部署到 Vercel（低調上線期間網址不寫進 repo）、Neon 新加坡；設定見 [deploy.md](deploy.md)。#214 只剩訪客生成一次、生成 2～3 份公開範例。

量測結果（2026-10-23，PLAN-002 之前）：一次生成 Google 約 US$0.24～0.41，30～50 秒（[runbook](runbook.md)）。PLAN-002 拿掉了每天的文案呼叫與三餐住宿的 LLM 呼叫，OpenAI 費用與生成時間應該下降，尚未重新量測。

## 下一步

1. #287：午餐、點心、晚餐可在當天拖拉。ADR-0010 草稿已確認，存在 #287 的留言；之後做 #288（說明哪些餐點可以拖）。
2. 使用者確認正式網站顯示正常後，可提前刪除 Neon 備份 branch。
3. #181 剩三件（使用者操作）：確認「My gmail」通知管道的實際地址、Gmail 搜尋以前的預算警示寄到哪、#214 時實際收到一次通知。預算提醒已連結自己的 email；Maps 的硬上限是每日配額（Google 新的支出上限不支援 Maps）；OpenAI 沒開自動儲值。#197 已確認 OpenAI 不分享資料，已關閉。
4. #261 隱私權說明頁 `/privacy` 與全站頁尾已完成；部署後由使用者在 Google Cloud 的 OAuth 同意畫面填上正式網址的 `/privacy`。`device_id` cookie 讀不到、每裝置額度沒作用的 #280 已修好，額度現在真的會依裝置計算。
5. #214 的公開範例（會花錢，先問），之後 #215 正式公開。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限（#213、#255）。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）。
- 子地點判斷的公園類、獨立目的地類型清單只以 8 組實測決定（`placeCandidatesToStopCandidates.ts`）；中英文名稱各一筆的重複抓不到（#272）。
- 開發前要先開 Docker Desktop 並 `npm run db:up`。
- 手動測試 `dev:free`：`TURNSTILE_SECRET_KEY="" npm run dev:free` 略過人機驗證；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
- 重新規劃產生的移動日沒有餐點（#290）。
