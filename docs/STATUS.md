# STATUS

更新：2026-10-20

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。第一張子 issue #182（`MOCK_AI` 涵蓋整個生成流程）的 PR 已開，分支 `plan-001-mock-ai-generate`，等使用者合併。

完成後的狀態：`npm run dev:free` 可以完全不花錢地生成整份行程；沒有 mock 的 OpenAI 呼叫在 `MOCK_AI` 下會被擋下而不是計費。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. #198 A0：量測一次生成的 Google 呼叫次數（`npm run dev:mock`，OpenAI 真實約 US$0.01，執行前先詢問），並把用量寫進資料庫。
3. #199 A1：決定地點顯示方式（自建補水 vs Places UI Kit）。

## 卡點與待決定

- 改造完成前，`.claude/rules/google-places.md` 禁止新增任何儲存 Google 內容的快取。
- 開放資料來源（Foursquare、OSM）的試做屬於營利階段，尚未開 issue。
- Dependabot PR #170、#47 還開著。
