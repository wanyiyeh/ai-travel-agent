# STATUS

更新：2026-10-26

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-002](plans/PLAN-002-llm-without-google-content.md) 已完成（父 issue #262，PR #273）：OpenAI 的輸入不再放任何 Google 內容，避開服務條款 3.2.3(c) 的灰色地帶（[ADR-0008](adr/0008-no-google-content-in-llm-input.md)，取代向 Google 書面詢問的 #207）。Google 地點的文案改用模板、大多數站留白；三餐與住宿改由規則挑選；`partOf` 改用 Google 的 `containingPlaces`。現在怎麼運作見[功能頁](features/place-copy-and-meals.md)。本機與正式資料庫的舊文案都已清除（#270）；Neon 的備份 branch `backup-before-270` 會在 2026-11-02 自動刪除。

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線仍在進行（父 issue #196）。已部署到 Vercel（低調上線期間網址不寫進 repo）、Neon 新加坡；設定見 [deploy.md](deploy.md)。#214 只剩訪客生成一次、生成 2～3 份公開範例。

量測結果（2026-10-23，PLAN-002 之前）：一次生成 Google 約 US$0.24～0.41，30～50 秒（[runbook](runbook.md)）。PLAN-002 拿掉了每天的文案呼叫與三餐住宿的 LLM 呼叫，OpenAI 費用與生成時間應該下降，尚未重新量測。

## 下一步

1. 用 `npm run dev:free` 生成一次，確認列表留白的站與三餐住宿看起來正常（免費）。
2. 使用者確認正式網站顯示正常後，可提前刪除 Neon 備份 branch。
3. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限，p0）、#197（OpenAI 不分享資料給訓練）。
4. #214 的公開範例（會花錢，先問），之後 #261（隱私權說明頁）、#215 正式公開。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限（#213、#255）。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）。
- 子地點判斷的公園類、獨立目的地類型清單只以 8 組實測決定（`placeCandidatesToStopCandidates.ts`）；中英文名稱各一筆的重複抓不到（#272）。
- 開發前要先開 Docker Desktop 並 `npm run db:up`。
- 手動測試 `dev:free`：`TURNSTILE_SECRET_KEY="" npm run dev:free` 略過人機驗證；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
