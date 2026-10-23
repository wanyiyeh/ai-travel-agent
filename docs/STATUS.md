# STATUS

更新：2026-10-23

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。#182、#198、#199（[ADR-0005](adr/0005-place-display-hybrid.md)）、#200（寫入時移除 Google 欄位，`COMPLIANT_PLACE_STORAGE=1` 控制，目前預設關閉）、#201、#202、#225 已合併。#203 拆成三個 PR，前兩個已合併；第三個（四張快取表不再讀寫，改成同一請求內共用 `src/lib/requestMemo.ts`；候選池放在 `PlaceSource` 介面後面）已開 PR，等使用者合併。

量測結果見 [runbook](runbook.md)；改成不快取之後的新數字還沒量（見卡點）。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. 用 `dev:free` 量測 #203 之後的每次生成費用，更新 runbook。
3. #204（座標 30 天清除）、#205（標示與 Places UI Kit；實作前先用免費 Demo Key 確認重新渲染與計費行為）、#206（清理舊欄位與四張快取表、開啟開關）。

## 卡點與待決定

- 量測要另開一個 dev server，但 port 3000 已有一個在跑（Next 不允許同一資料夾兩個 dev server）；需要使用者先停掉它。
- 每日 Google 上限 US$3 只夠約 4 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。不快取之後同城市重複生成會再付費，數字可能再上升。
- #188（Nearby 降到 Pro）的效益變小：每次生成的 Nearby Enterprise 只剩 1～2 次。
- 手動測試 `dev:free`：開關與人機驗證用 `COMPLIANT_PLACE_STORAGE=1 TURNSTILE_SECRET_KEY="" npm run dev:free`；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
