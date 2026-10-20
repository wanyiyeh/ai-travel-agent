# 決策紀錄（ADR）

一個決策一個檔案，檔名 `NNNN-<slug>.md`（四位數編號）。只記錄「有取捨的決定」，不記過程細節。只新增不改寫；被推翻時把狀態改成 `Superseded by ADR-XXXX`。

## 索引

| 編號 | 標題 | 狀態 | 日期 |
| --- | --- | --- | --- |
| 0001 | [文件與任務管理：Issues + git + STATUS + plans](0001-docs-and-task-management.md) | Accepted | 2026-10-19 |
| 0002 | [保留 PR 合併，Claude 以受限 token 操作 git 與 GitHub](0002-pr-flow-with-scoped-token.md) | Accepted | 2026-10-19 |
| 0003 | [作品集上線使用 Vercel + Neon，兩者都在新加坡](0003-vercel-and-neon.md) | Accepted | 2026-10-20 |
| 0004 | [Google 地點內容只存 place ID 與 30 天內的座標](0004-google-maps-content-storage.md) | Accepted | 2026-10-20 |

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
