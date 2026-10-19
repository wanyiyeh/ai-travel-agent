---
paths:
  - "docs/**/*.md"
---

# 文件撰寫規範

- 語言：繁體中文；程式碼識別字、檔名、指令、地名保持原文。
- 一件事只寫在一個地方。要引用別處的內容就放連結，不複製。
- 不手抄權重、門檻、距離等參數；寫「參數見 `<程式碼路徑>` 的 `<常數名>`」。
- 引用 `docs/` 以外的程式碼路徑用行內程式碼（`` `src/lib/db.ts` ``），不要寫成 markdown 連結。
- 功能頁（`docs/features/*.md`）一律用固定模板，frontmatter 包含 `status`、`updated`、`source`、`adr`、`plan`。修改功能頁時同步更新 `updated`（`YYYY-MM-DD`）。
- 決策放 `docs/adr/`，一個決策一個檔，用 `docs/adr/README.md` 的模板；功能頁只放一行 ADR 連結。ADR 只新增不改寫，被推翻時把狀態改成 `Superseded by ADR-XXXX`。
- 待辦、進度、路線圖不得出現在 md 檔，一律在 GitHub Issues。
- 流程與狀態圖用 Mermaid；規則、因子、狀態用表格。
- 每份文件控制在一到兩頁；超過就拆分，不要寫成流水帳。
- 新增文件後，更新對應索引（`features/index.md`、`adr/README.md`、`plans/README.md`）與 `docs/index.md` 的導覽。
- `docs/STATUS.md` 是覆蓋式交接筆記，只有三段：現在在做什麼 / 下一步 / 卡點與待決定。
