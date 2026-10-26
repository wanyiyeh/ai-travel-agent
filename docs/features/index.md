# 功能總覽

每個功能一頁，記錄「現在怎麼運作」。功能完成或從舊文件遷移時才建立頁面。

| 功能 | 狀態 | 最後更新 |
| --- | --- | --- |
| [地點文案與三餐住宿的挑選](place-copy-and-meals.md) | stable | 2026-10-26 |
| [刪除帳號](account-deletion.md) | stable | 2026-10-26 |

## 功能頁模板

新增功能頁時複製下面的結構（frontmatter 與章節都要保留）：

````markdown
---
status: draft            # draft | stable
updated: YYYY-MM-DD
source:                  # 對應的程式碼路徑
  - src/lib/xxx.ts
adr: []                  # 相關決策，例如 [1, 3]
plan: PLAN-NNN
---

# 功能名稱

## 一句話
這個功能回答什麼問題

## 流程
（Mermaid 流程圖）

## 規則 / 狀態
（表格）

## 參數
參數見 `<程式碼路徑>` 的 `<常數名>`。（標註「已確認」或「待校準」）

## 成本
會呼叫哪些付費 API、有哪些快取（沒有就寫「無」）

## 已知限制
（同時開 issue 標 `known-limitation`）

## 相關連結
ADR、plan、issue
````
