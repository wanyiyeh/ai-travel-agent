# STATUS

更新：2026-10-25

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-002](plans/PLAN-002-llm-without-google-content.md)（`in-progress`，父 issue #262，子 issue #263～#271，分支 `plan-002-llm-without-google-content`）：LLM 的輸入不放任何 Google 內容，Google 地點的文案改用模板（大多數站留白），避開服務條款 3.2.3(c) 的灰色地帶，取代向 Google 書面詢問（#207）。決策見 [ADR-0008](adr/0008-no-google-content-in-llm-input.md)。`partOf` 改用 Google 的 `containingPlaces`（2026-10-25 實測 8 組）。#207、#226 已以 not planned 關閉。

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線仍在進行（父 issue #196）。已部署到 Vercel（低調上線期間網址不寫進 repo）、Neon 新加坡；設定見 [deploy.md](deploy.md)。#214 低調上線只剩訪客生成一次、生成 2～3 份公開範例。

量測結果（2026-10-23）：一次生成 Google 約 US$0.24～0.41，30～50 秒（[runbook](runbook.md)）。GCP 每日配額已設。

## 下一步

1. PLAN-002：#263～#269、#276、#277 已完成（餐點與住宿改由規則挑選，生成主流程只剩沒有候選時才請 LLM 自己推薦店名）；剩 #270（清除舊文案，執行前先列影響範圍請使用者確認）、#271（文件），之後用 `dev:free` 看一次畫面。
2. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限，p0）、#197（OpenAI 不分享資料給訓練）。
3. PLAN-002 完成後再做 #214 的公開範例（現在生成會帶舊文案，要重做），之後 #215 正式公開。
4. 公開前另需 #261（隱私權說明頁）。

## 卡點與待決定

- #270 清除舊文案前，要先列出受影響的行程請使用者確認。
- 中英文名稱各一筆的重複景點抓不到（#272，known-limitation）。
- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限（#213、#255）。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）。
- 開發前要先開 Docker Desktop 並 `npm run db:up`。
- 手動測試 `dev:free`：`TURNSTILE_SECRET_KEY="" npm run dev:free` 略過人機驗證；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
