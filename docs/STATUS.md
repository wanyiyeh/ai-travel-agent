# STATUS

更新：2026-10-19

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

文件系統改造（參照 epifolio，見 [ADR-0001](adr/0001-docs-and-task-management.md)）。目前這個分支 `docs/doc-system` 建立骨架：`CLAUDE.md`、`.claude/rules/`、`/doc-audit`、`.claude/settings.json`、issue 模板、label 腳本、docs 的索引與模板、改寫 `architecture.md`。

## 下一步

1. 合併骨架後，把本機 `CLAUDE.local.md` 精簡成只剩本機專屬設定（規則已移到 `CLAUDE.md`）。
2. 跑 `scripts/setup-labels.sh` 建立 labels。
3. 從 `plan/*.md`、`docs/process.md`、`docs/lib.md` 整理出待辦清單，使用者確認後批次開成 issue。
4. `plan/*.md` 搬進 `docs/plans/` 並編號。
5. 知識遷移：features 頁、補寫過去決策的 ADR、`data-sources.md`、`runbook.md`、`vision.md`；封存 `docs/process.md`。

## 卡點與待決定

- `docs/vision.md` 的「非目標」需要使用者決定（例如部署、付費方案、多語系是否在範圍內）。
- 兩個 Dependabot PR 還開著：#170（minor/patch）、#47（openai 6 → 7，major 升級，需要確認相容性）。
