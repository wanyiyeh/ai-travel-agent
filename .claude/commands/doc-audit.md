---
description: 檢查文件與程式碼的一致性，只產出報告，不修改任何檔案
---

# 文件健檢

只讀取、不修改，不呼叫任何付費 API。依序檢查並彙整成一份報告：

1. **功能頁來源**：對 `docs/features/*.md`（不含 `index.md`）逐頁讀 frontmatter 的 `source`。
   - `source` 指向的路徑是否仍存在？
   - 用 `git log -1 --format=%cs -- <path>` 取得來源最後修改日期，若晚於該頁的 `updated`，標記為「疑似過期」。
   - 缺少 `status`、`updated`、`source` 任一欄位者標記。
2. **索引完整性**：`docs/features/` 每頁都列在 `features/index.md`；`docs/adr/` 每篇都列在 `adr/README.md`；`docs/plans/` 每份都列在 `plans/README.md`。
3. **連結**：`docs/` 內的相對 markdown 連結是否指向存在的檔案；行內程式碼寫的路徑（`` `src/...` ``）是否存在。
4. **禁止內容**：在 `docs/` 中搜尋 `TODO`、`FIXME`、`待辦`、`- [ ]`（`docs/plans/` 與各索引頁的模板區塊、`docs/archive/` 除外），列出位置。
5. **手抄參數**：在 `docs/features/`、`docs/architecture.md` 搜尋帶單位的數字（`km`、`公里`、`分鐘`、`公尺`），列出疑似手抄的參數。
6. **CLAUDE.md 篇幅**：行數是否超過 150；超過就建議拆去 `.claude/rules/`。
7. **STATUS.md**：`更新` 日期是否早於最近一次 commit 日期超過 7 天。
8. **計畫狀態**：`docs/plans/` 中 `status: done` 的計畫，內容是否已遷移到 features 或 ADR（檢查是否有對應連結）。
9. **Issue 一致性**：`status: in-progress` 的計畫，父 issue（frontmatter `issue`）是否仍為 open；`done` 的計畫父 issue 是否已關閉（`gh issue view <編號> --json state`）。

報告格式（繁體中文）：

- 先給一行總結：幾項正常、幾項需處理。
- 再列「需處理」清單，每項包含：檔案路徑、問題、建議做法。
- 最後只列「正常」項目的數量，不逐項展開。

結束時詢問使用者要不要依報告逐項修正。
