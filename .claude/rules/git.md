# Git 流程與 Commit 規範

## 權限邊界（ADR-0002）

- `gh` 與 `git push` 用的是只限本 repo 的 fine-grained token：可寫 contents、pull requests、issues；**不能**改 `.github/workflows/`、repo 設定、ruleset。需要改 workflow 時，準備好改動請使用者自己 push。
- `main` 有 ruleset：必須走 PR、必須通過 `ci` 檢查、禁止 force push 與刪除，沒有 bypass。

## 分支

- **絕不在 `main` 上改**。每個新任務開始前：
  1. `git branch --show-current`、`git fetch origin`、`git log --oneline HEAD..origin/main`
  2. 從最新的 `origin/main` 開新分支（命名見 `CLAUDE.md` 第 6 節，名稱不可與本機既有分支重複，R3），然後 `git branch --unset-upstream`，避免 `git push` 預設推向 `main`。
- 目前分支還有未合併的工作，或分支名與新任務主題明顯不符 → 先停下來問使用者：
  - (B) 先把目前的 PR 合併，再從 `origin/main` 開新分支 ← **預設建議**
  - (C) 在目前分支繼續（僅限同一主題的延續）
- 分支名相符且是同一主題，或使用者已說「就在這改」→ 直接做。

## Commit、push 與 PR

- **Commit 由 Claude 處理**：完成一個邏輯變更、通過 `CLAUDE.md` 第 9 節的檢查後就 commit，不需要每次詢問。使用者說要自己 commit 的那一次例外。
- commit 前：`git status`、`git diff --cached` 檢查沒有秘密或無關檔案；`git add <檔名>` 逐一加入。
- 第一次 push：`git push -u origin <branch>`，接著 `gh pr create`（英文標題與內容，R4）。之後每次 commit 後 `git push`。
- PR description 格式參考過去的 PR：`## Summary`（為什麼）、`## Changes`、`## Testing`（跑了什麼、結果）；結尾 `Closes #N`。有呼叫付費 API 的驗證，寫出呼叫了什麼、幾次。
- 每次 push 後檢查 CI：`gh pr checks <PR> --watch --fail-fast`；失敗時 `gh run view <run-id> --log-failed`。

## CI 失敗分級

- **小問題 → 直接修**：格式、lint、型別、漏產生的檔案等，修法明確且不改變行為或設計。補一筆新的 commit、push、再確認 CI，完成後簡短告知使用者「CI 抓到什麼、怎麼修的」。
- **大問題 → 停下來回報**：需要改變功能行為、Prisma schema、架構或相依套件版本；原因不明或本機無法重現；同一問題修兩次仍失敗；需要改 `.github/workflows/`。回報失敗步驟、錯誤摘要、推測原因、建議修法，等使用者決定。

## 歷史

- 不改寫已 push 的歷史：不 `commit --amend` 已 push 的 commit，不 force push（含 `--force-with-lease`），不 rebase、squash、cherry-pick（R2）。
- 分支落後 `main` 而產生衝突時：`git merge origin/main` 進分支解衝突，不 rebase。

## 合併（使用者的決定）

使用者說「合併 / merge」才執行：

1. 確認該 PR 最新一次 CI 通過（未通過先依上面分級處理）。
2. 最後一個 commit 已把 `docs/STATUS.md` 寫成合併後的狀態。
3. `gh pr merge <PR> --merge --delete-branch`（merge commit，不 squash、不 rebase）。
4. `git switch` 到下一個工作分支或停在原處；確認 `main` 的 CI 通過。

## Commit message 規範

格式（全英文，對應 `.gitmessage`）：

```
type(scope): imperative summary in lowercase

Optional paragraph: why the change was made, and anything deliberately
left out.

- What changed, one logical change per bullet
- Keep identifiers and file paths as-is (buildDaySkeleton, src/lib/db.ts)

Refs #12
```

- **type**（僅限）：`feat` / `fix` / `refactor` / `perf` / `style` / `docs` / `test` / `chore` / `ci` / `build`
  - `style` 只用於不影響畫面的程式碼格式；UI 視覺調整用 `feat` 或 `fix`
- **scope**：模組名，例如 `scheduler`、`places`、`restructure`、`food`、`auth`、`db`、`ui`、`docs`、`plan`。跨兩個模組用逗號；更多就省略。不用動作當 scope。
- **header**：祈使語氣、小寫開頭、不加句號、不超過 72 字元。
- **body**：每行約 72 字元換行；小改動可以只有 header。
- 一個 commit 只做一個邏輯變更。**不加任何 AI 署名 trailer。**
