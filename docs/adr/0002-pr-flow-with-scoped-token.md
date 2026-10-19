# ADR-0002：保留 PR 合併，Claude 以受限 token 操作 git 與 GitHub

日期：2026-10-19
狀態：Accepted

## 背景

採用 ADR-0001 的文件系統後，issue、PR、CI 都要靠 `gh` 操作。原本 commit、push 都由使用者自己執行，Claude 只提出拆分建議；要讓流程順暢，需要讓 Claude 自己 commit、push、看 CI。

epifolio 的做法是不開 PR，本機 fast-forward 合併。但這個專案：

- 是作品集，PR 紀錄（標題、說明、測試結果）是對外展示的一部分；
- 不使用 rebase（`CLAUDE.md` R2），而 fast-forward 合併在 `main` 前進時必須 rebase 再 force push。

## 決策

- **保留 PR**：Claude commit、push 功能分支、開 PR、盯 CI；使用者說「合併」且 CI 通過才用 `gh pr merge --merge` 合併（merge commit）。
- **受限 token**：`gh` 與 `git push` 用只限本 repo 的 fine-grained token，只有 contents、pull requests、issues 寫入權限，以及 actions、commit statuses 讀取權限；沒有 Administration、Workflows。`gh auth setup-git` 讓 `git push` 也走這個 token。
- **GitHub 端保護**：`main` 的 ruleset 要求 PR、`ci` 檢查通過，禁止 force push 與刪除，沒有 bypass。公開 repo 開啟 secret scanning 與 push protection。
- **本機防護**：`.claude/settings.json` 拒絕 force push、push 到 `main`、`git add -A`、rebase、cherry-pick、`--no-verify`；`gh pr merge` 與刪分支要先問。

## 考慮過的替代方案

- 照 epifolio 本機 ff-only 合併、不開 PR：與不 rebase 的規則衝突，也失去作品集的 PR 紀錄。
- 維持使用者自己 commit 與 push：安全，但每一步都要人工介入，CI 失敗也要使用者轉述給 Claude。
- 給 Claude 使用者帳號的完整權限（OAuth 登入）：能存取帳號下所有 repo，也能改 workflow 與 repo 設定，風險過大。

## 後果

- Claude 不能修改 `.github/workflows/`；CI 設定的改動由使用者 push。
- 最壞情況（指令誤判、deny 清單沒擋到）也只能影響功能分支，`main` 由 ruleset 保護。
- token 有效期限到期要重建；`gh` 未登入時，issue 與 PR 流程無法運作。
- commit 作者仍是使用者本人的 git 設定，不加 AI 署名。

## 相關

`.claude/rules/git.md`、`.claude/settings.json`、`CLAUDE.md` 第 6 節、[ADR-0001](0001-docs-and-task-management.md)
