# STATUS

更新：2026-10-20

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線的計畫草稿（`status: draft`），在分支 `plan-001-portfolio-launch`，附 [ADR-0003](adr/0003-vercel-and-neon.md)（Vercel + Neon）與 [ADR-0004](adr/0004-google-maps-content-storage.md)（Google 內容只存 place ID 與 30 天座標）兩份草稿，等使用者確認。

背景：調查發現現有快取（`Place` 表、行程內的名稱地址、`DistanceCache` 等）不符合 Google Maps Platform 條款，上線前必須改造。`.claude/rules/google-places.md` 已加上「改造完成前不得新增 Google 內容快取」。

## 下一步

1. 使用者確認計畫與兩份 ADR 的草稿，以及「待決定」的四項。
2. 確認後：`status: approved`，建立父 issue（label `plan`）與子 issue，開始做前置任務（#181、#182）。

## 卡點與待決定

- PLAN-001「待決定」：每日最高 Google 花費、正式環境是否另開 key、網域（訪客可生成已決定）。
- 開放資料來源（Foursquare、OSM）的試做屬於營利階段，尚未開 issue。
- Dependabot PR #170、#47 還開著。
