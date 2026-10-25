# 計畫（Plans）

做之前寫的規格。檔名 `PLAN-NNN-<slug>.md`。完成後 `status: done`，持久知識遷移到 `docs/features/` 與 `docs/adr/`。

狀態流轉：`draft` → `approved`（使用者確認）→ `in-progress` → `done`。
進度只記在 GitHub Issues，計畫檔不勾選任務。

根目錄 `plan/` 的舊計畫尚未搬進來（[ADR-0001](../adr/0001-docs-and-task-management.md)）。

## 索引

| 編號 | 標題 | 狀態 | 父 issue |
| --- | --- | --- | --- |
| [PLAN-001](PLAN-001-portfolio-launch.md) | 作品集上線（Vercel + Neon，符合 Google Maps Platform 條款） | in-progress | #196 |
| [PLAN-002](PLAN-002-llm-without-google-content.md) | LLM 的輸入不放 Google 內容，Google 地點的文案改用模板 | in-progress | #262 |

## 模板

````markdown
---
status: draft            # draft | approved | in-progress | done
branch: plan-NNN-slug
issue:                   # 父 issue 編號，approved 後填寫
created: YYYY-MM-DD
---

# PLAN-NNN：標題

## 目標
為什麼做、解決什麼問題

## 非目標
這次不做的事

## 驗收條件
- 可驗證的條件（子 issue 的驗收依據）

## 邊界情況
空狀態、錯誤、極端輸入、沒有網路或 Google 回傳空結果

## 成本
驗證時會呼叫哪些付費 API、大約幾次

## 設計摘要
資料、流程、介面的重點；有取捨之處連到 ADR

## 任務拆解
1. 任務（→ 對應一張子 issue，approved 後在此填入編號）
2. 任務

## 完成後遷移清單
- [ ] 功能頁：docs/features/xxx.md
- [ ] ADR：docs/adr/xxxx-xxx.md
- [ ] glossary 新詞
````
