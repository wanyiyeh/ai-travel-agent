# STATUS

更新：2026-10-23

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。#182、#198、#199（[ADR-0005](adr/0005-place-display-hybrid.md)）、#200（寫入時移除 Google 欄位，`COMPLIANT_PLACE_STORAGE=1` 控制，目前預設關閉）、#201、#202、#225、#233（Next.js 升到 16.4.2，修 critical 漏洞）已合併。#203（四張快取表不再讀寫，改成同一請求內共用 `src/lib/requestMemo.ts`）已合併。#204（座標附取得時間、超過 30 天刪除，[ADR-0006](adr/0006-coordinate-expiry.md)）已合併；每天自動執行在 #211 接上。#205（沒有地圖的畫面加上 Google Maps 標誌；點照片縮圖打開 Places UI Kit 地點詳情，實測重新渲染不會多計費）PR #238 已開，等使用者合併。

量測結果（2026-10-23，`dev:free`）：一次生成 Google 約 US$0.24～0.41，最貴的是 Nearby Search Pro；假的 OpenAI 會讓 Text Search 少算。方法與數字見 [runbook](runbook.md)。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. #206（清理舊欄位與四張快取表、開啟開關）。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。不快取之後同城市重複生成也要全額付費。
- #188（Nearby 降到 Pro）的效益變小：每次生成的 Nearby Enterprise 只剩 1～2 次。
- 手動測試 `dev:free`：開關與人機驗證用 `COMPLIANT_PLACE_STORAGE=1 TURNSTILE_SECRET_KEY="" npm run dev:free`；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
