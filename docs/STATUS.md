# STATUS

更新：2026-10-20

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。#182（`MOCK_AI` 涵蓋整個生成流程）已合併。#198（量測生成花費）已合併。#199（A1）已決定混合方式（[ADR-0005](adr/0005-place-display-hybrid.md)）並合併。#200（A2：寫入時移除 Google 欄位）已合併，以 `COMPLIANT_PLACE_STORAGE=1` 控制，目前預設關閉。#201（補水）拆成三個 PR：第一個（補水核心 `src/lib/placeDisplay.ts`，尚未接上任何路由）已開，等使用者合併。

量測結果：一次生成（快取全部沒命中）Google 約 US$0.52～0.79、OpenAI 約 US$0.003，每月約 500 次生成在 Google 免費額度內。方法與數字見 [runbook](runbook.md)。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. #201 第二個 PR：接上讀取路徑（`GET /api/v1/itinerary/[id]` 只補第一天、展開其他天時補該天、`authorizeItinerary` 補操作用到的那一天），補水呼叫用 `runMetered` 計量，畫面處理 `displayUnavailable`。第三個 PR：逐一檢查伺服器端用到名稱的流程。
3. 之後做 #202（只展開第一天）；詳情面板的 Places UI Kit 實作前，先用免費 Demo Key 確認重新渲染與計費行為。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 4 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。
- #188（Nearby 降到 Pro）的效益變小：每次生成的 Nearby Enterprise 只剩 1～2 次。
- 改造完成前，`.claude/rules/google-places.md` 禁止新增任何儲存 Google 內容的快取。
- Dependabot PR #170、#47 還開著。
