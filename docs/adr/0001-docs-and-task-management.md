# ADR-0001：文件與任務管理採用 Issues + git + STATUS + plans

日期：2026-10-19
狀態：Accepted

## 背景

這個專案主要與 Claude Code 協作，每次對話都從空白開始，要靠文件快速進入狀況。舊的做法有幾個問題：

- 待辦散在 `plan/*.md`、`docs/process.md`、`docs/lib.md` 的技術債段落，沒有一個地方能看到全部；GitHub Issues 完全沒用。
- `docs/process.md` 是按日期累加的流水帳，已經超過兩千行，內容又跟 commit 與 PR 重複。為了記它，大約三分之一的 PR 是只改 process log 的 docs PR。
- `plan/*.md` 格式與狀態寫法各自不同，完成後沒有封存，進度直接勾在計畫檔裡。
- 決策埋在流水帳裡，想翻案時找不到當初否決了什麼。
- 按技術層分的參考文件（`api-overview.md`、`lib.md` 等）要手動維護，會過期，也沒辦法判斷有沒有過期；文件裡手抄的距離門檻在調參後跟程式碼不一致。
- 規則與踩雷記在只存在本機的 `CLAUDE.local.md` 和 Claude memory，換環境就讀不到。

參考對象是 epifolio 專案的文件系統（同樣是與 Claude Code 協作的單人專案）。

## 決策

每種資訊只存在一個地方：

| 資訊 | 存放處 |
| --- | --- |
| 待辦、優先序、不做 | GitHub Issues（PR 寫 `Closes #N` 自動關閉） |
| 做了什麼、何時做的 | git commit 與 PR description |
| 現在在哪、下一步 | `docs/STATUS.md`（覆蓋式，不累加歷史） |
| 做之前的規格 | `docs/plans/`（完成後持久知識遷移到 features / ADR） |
| 為什麼這樣決定 | `docs/adr/` |
| 現在怎麼運作 | `docs/features/`（frontmatter `source` 指向程式碼） |
| 專有名詞 | `docs/glossary.md` |
| 參數 | 程式碼（文件只引用路徑） |
| 規則與踩雷 | `CLAUDE.md` 第 11 節的編號規則 |

`CLAUDE.md` 進 git、控制在 150 行內，細部規則依路徑拆到 `.claude/rules/`；`/doc-audit` 定期檢查文件與程式碼是否一致。`docs/process.md` 封存，不再新增。

## 考慮過的替代方案

- 維持現狀（process log + plan 檔記進度）：持續膨脹、依賴記得手動同步，已經出現過期內容。
- 只靠 `CLAUDE.md`：規則、現況、待辦混在一起，篇幅失控後遵守度下降。
- 保留 process log 但改成精簡的里程碑頁：又多一個要手動同步的地方；作品集故事改由 PR description 承載。

## 後果

- 開新對話時，Claude 先讀 `docs/STATUS.md` 再 `gh issue list`，需要 `gh` 已登入。
- md 檔不得出現待辦清單或進度紀錄；發現新工作一律開 issue。
- 每次對話結束都要覆蓋 `docs/STATUS.md`。
- 文件更新跟著功能 PR 一起送，不再另開 docs PR。
- 遷移期間舊文件仍在 `docs/` 與 `plan/`，以程式碼為準。

## 相關

`CLAUDE.md` 第 1、7、8、9 節、`.claude/rules/docs.md`、`.claude/commands/doc-audit.md`、[ADR-0002](0002-pr-flow-with-scoped-token.md)
