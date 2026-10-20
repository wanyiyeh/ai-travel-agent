# STATUS

更新：2026-10-20

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線已核准（`approved`），父 issue #196，22 張子 issue 已連結（含既有的 #181、#182、#188）。[ADR-0003](adr/0003-vercel-and-neon.md)（Vercel + Neon）與 [ADR-0004](adr/0004-google-maps-content-storage.md)（Google 內容只存 place ID 與 30 天座標）已 Accepted。

已決定：訪客可生成、正式與開發共用一組 key、Google 每日上限 US$3、平台子網域並分兩階段上線。

## 下一步

1. 合併計畫的 PR 後，從前置任務開始：#181（使用者在 GCP、OpenAI 主控台操作）、#197（使用者確認 OpenAI 資料分享設定）、#182（`MOCK_AI` 擴充到生成主流程）。
2. 之後依序做 A（#198 起），再做 B（#208 起）。
3. 每張子 issue 一個分支、一個 PR，分支名稱以 `plan-001-` 開頭，PR 結尾寫 `Closes #<子 issue>`；開始做第一張時把計畫改成 `in-progress`。

## 卡點與待決定

- 改造完成前，`.claude/rules/google-places.md` 禁止新增任何儲存 Google 內容的快取。
- 開放資料來源（Foursquare、OSM）的試做屬於營利階段，尚未開 issue。
- Dependabot PR #170、#47 還開著。
