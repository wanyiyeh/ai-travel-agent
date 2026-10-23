# STATUS

更新：2026-10-23

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。**已部署到 Vercel**（低調上線期間網址不寫進 repo，見 Vercel 專案）（Vercel Hobby、函式在新加坡；資料庫是 Neon 新加坡的 `travel`，preview 用 `travel_mock` 且全部 mock）。設定步驟見 [deploy.md](deploy.md)，完成紀錄在 #213。上線檢查都通過：Google 登入、一次生成、每日清理、正式資料庫稽核 No violations。

Google 合規（A 系列，ADR-0004～0006）與部署準備（#208～#213）都已合併。#258（行程列表每個地點加「照片與詳情」按鈕，打開 Places UI Kit）已合併。#214 低調上線進行中：頁面帶 `noindex`、repo 裡不寫正式網址；正式環境已驗證安全標頭、權限、登入、跨站阻擋、限流 429、稽核 0 筆。剩使用者在正式環境以訪客生成一次、生成 2～3 份公開範例。

量測結果（2026-10-23）：一次生成 Google 約 US$0.24～0.41；生成時間 30～50 秒（[runbook](runbook.md)）。GCP 每日配額已設（GetPlace 800、SearchNearby 300、SearchText 300、Photo 300、RouteMatrix 400，用不到的 API 設 0），GetPlace 有 80% 用量警告。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）、#207（書面詢問 Google 灰色地帶）。
2. #214 剩下的訪客生成與公開範例（使用者操作，會花錢），之後 #215 正式公開（拿掉 `noindex`、README 加網址與範例連結）。
3. 可穿插的小項目：#242（減少 Nearby 次數的評估）、#239（mock 模式的地圖不要計費）。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。不快取之後同城市重複生成也要全額付費。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）；`/dev/place-details` 測試頁也用真的 key。
- 開發前要先開 Docker Desktop 並 `npm run db:up`，否則連不上資料庫。
- 手動測試 `dev:free`：人機驗證用 `TURNSTILE_SECRET_KEY="" npm run dev:free` 略過；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
