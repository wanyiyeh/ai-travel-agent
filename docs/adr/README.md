# 決策紀錄（ADR）

一個決策一個檔案，檔名 `NNNN-<slug>.md`（四位數編號）。只記錄「有取捨的決定」，不記過程細節。只新增不改寫；被推翻時把狀態改成 `Superseded by ADR-XXXX`。

## 索引

| 編號 | 標題 | 狀態 | 日期 |
| --- | --- | --- | --- |
| 0001 | [文件與任務管理：Issues + git + STATUS + plans](0001-docs-and-task-management.md) | Accepted | 2026-10-19 |
| 0002 | [保留 PR 合併，Claude 以受限 token 操作 git 與 GitHub](0002-pr-flow-with-scoped-token.md) | Accepted | 2026-10-19 |
| 0003 | [作品集上線使用 Vercel + Neon，兩者都在新加坡](0003-vercel-and-neon.md) | Accepted | 2026-10-20 |
| 0004 | [Google 地點內容只存 place ID 與 30 天內的座標](0004-google-maps-content-storage.md) | Accepted | 2026-10-20 |
| 0005 | [列表由伺服器補查名稱與地址，地點詳情改用 Places UI Kit](0005-place-display-hybrid.md) | Accepted | 2026-10-20 |
| 0006 | [每個座標附上取得時間，超過 30 天就刪除](0006-coordinate-expiry.md) | Accepted | 2026-10-23 |
| 0007 | [本機開發與整合測試用 Docker 跑 Postgres，CI 用 Postgres service](0007-local-postgres-docker.md) | Accepted | 2026-10-23 |
| 0008 | [LLM 的輸入不放任何 Google Maps 內容，Google 地點的文案改用模板](0008-no-google-content-in-llm-input.md) | Accepted | 2026-10-25 |
| 0009 | [移動日的交通留在 stops 裡、標記成交通站，早餐改由規則挑選](0009-transit-leg-as-pinned-stop.md) | Accepted | 2026-10-26 |
| 0010 | [午餐、點心、晚餐可以在當天拖拉，位置存成「前面有幾站」；餐點可以刪除](0010-draggable-meals.md) | Accepted | 2026-10-27 |
| 0011 | [機場資料改用開放資料產生，人工清單只做覆寫](0011-airport-data-from-open-sources.md) | Accepted | 2026-10-28 |

## 模板

````markdown
# ADR-NNNN：用決定本身當標題

日期：YYYY-MM-DD
狀態：Proposed | Accepted | Superseded by ADR-XXXX

## 背景
當時遇到什麼問題、有什麼限制，逼你要做這個決定

## 決策
最後選了哪個方案

## 考慮過的替代方案
- 方案 A：否決理由

## 後果
往後的程式碼與流程因此要遵守什麼；有哪些代價

## 相關
功能頁、plan、issue、程式碼路徑
````
