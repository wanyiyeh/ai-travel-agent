# STATUS

更新：2026-10-23

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。#182（`MOCK_AI` 涵蓋整個生成流程）已合併。#198（量測生成花費）已合併。#199（A1）已決定混合方式（[ADR-0005](adr/0005-place-display-hybrid.md)）並合併。#200（A2：寫入時移除 Google 欄位）已合併，以 `COMPLIANT_PLACE_STORAGE=1` 控制，目前預設關閉。#201（補水）已完成。#202（行程頁只展開第一天，其他天、列印、地圖需要時才補名稱）已完成：使用者用 `dev:free` 開啟開關手動驗證，重新整理只補第一天、每展開一天只補那一天。#225（已登入的使用者換資料庫後存檔失敗）已修。#203 拆成三個 PR：第一個（文字不寫入 Google 的評分、地址、飯店名稱）已合併；第二個（找地點改用 IDs Only + Essentials，`Place` 表只存 ID 與座標）已開，等使用者合併。

量測結果：一次生成（快取全部沒命中）Google 約 US$0.52～0.79、OpenAI 約 US$0.003，每月約 500 次生成在 Google 免費額度內。方法與數字見 [runbook](runbook.md)。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. #203 第三個 PR：候選池、路線時間、最近車站四張快取表直接不存（2026-10-22 決定，理由見 #203）、地點來源介面、量測費用；詳情面板的 Places UI Kit 實作前，先用免費 Demo Key 確認重新渲染與計費行為。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 4 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。
- #188（Nearby 降到 Pro）的效益變小：每次生成的 Nearby Enterprise 只剩 1～2 次。
- 改造完成前，`.claude/rules/google-places.md` 禁止新增任何儲存 Google 內容的快取。
- 手動測試 `dev:free`：開關與人機驗證用 `COMPLIANT_PLACE_STORAGE=1 TURNSTILE_SECRET_KEY="" npm run dev:free`；已登入也能用（#225 已修）；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
