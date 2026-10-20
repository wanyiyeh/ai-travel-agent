# STATUS

更新：2026-10-20

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。#182（`MOCK_AI` 涵蓋整個生成流程）已合併。#198（A0：量測生成花費、用量寫進資料庫）的 PR 已開，分支 `plan-001-usage-metering`，等使用者合併。

量測結果：一次生成（快取全部沒命中）Google 約 US$0.52～0.79、OpenAI 約 US$0.003，每月約 500 次生成在 Google 免費額度內。方法與數字見 [runbook](runbook.md)。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. #199 A1：決定地點顯示方式（自建補水 vs Places UI Kit），寫成 ADR。
3. 之後依序做 #200（脫水）、#201（補水）。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 4 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。
- #188（Nearby 降到 Pro）的效益變小：每次生成的 Nearby Enterprise 只剩 1～2 次。
- 改造完成前，`.claude/rules/google-places.md` 禁止新增任何儲存 Google 內容的快取。
- Dependabot PR #170、#47 還開著。
