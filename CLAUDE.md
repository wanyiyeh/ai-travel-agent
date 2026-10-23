# ai-travel-agent

以機票為核心的 AI 旅遊行程規劃工具。輸入去回程航班與偏好，產生每日景點、住宿、三餐，可再編輯、重新生成或重新規劃城市。作品集專案，尚未部署。
技術棧：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS、Prisma + PostgreSQL（本機 Docker、正式 Neon）、OpenAI、Google Places / Routes、Auth.js（版本以 `package.json` 為準）。

## 1. 工作階段規則

- 溝通用繁體中文。
- 開始：先讀 `docs/STATUS.md`，再 `gh issue list` 看待辦，依任務讀相關文件（見第 2 節）。
- 結束或中斷前：**覆蓋更新** `docs/STATUS.md`（現在在做什麼 / 下一步 / 卡點與待決定），只寫現況，不累加歷史。
- 不確定就先問，一次問完，不要臆測需求。
- 重大取捨（資料模型、生成流程、外部 API、套件選型）：先提 ADR 草稿請使用者確認，再實作。
- 不擅自擴大範圍：發現額外問題就開 issue，不順手改。
- 小改動（不超過一個檔案、沒有取捨）直接做，不需要計畫或 issue。

## 2. 文件地圖

| 文件 | 用途 |
| --- | --- |
| `docs/STATUS.md` | 交接筆記：現在在哪、下一步、卡點 |
| `docs/architecture.md` | 系統總覽、資料流、資料模型 |
| `docs/glossary.md` | 領域詞彙與對應的程式碼識別字 |
| `docs/features/` | 每個功能「現在怎麼運作」 |
| `docs/adr/` | 決策紀錄：為什麼選 A 不選 B |
| `docs/plans/` | 計畫（規格）：做之前寫，完成後封存 |
| `docs/runbook.md` | 維運步驟：量測花費、部署、排程、成本排查 |
| GitHub Issues | 待辦、優先序、「明確不做」（唯一來源） |
| `.claude/rules/git.md` | 分支、PR、CI、合併、commit 規範（每次載入） |
| `.claude/rules/coding.md` | 技術棧細節、資料庫、測試、已知陷阱（動 `src/`、`prisma/`、`scripts/`、`tests/` 時載入） |
| `.claude/rules/google-places.md` | Google API 成本防護（動 `src/lib/`、`src/app/api/`、`scripts/` 時載入） |
| `.claude/rules/docs.md` | 文件撰寫規範（動 `docs/` 時載入） |

遷移中（ADR-0001）：`plan/*.md` 尚未搬進 `docs/plans/`；`docs/api-overview.md`、`lib.md`、`database.md`、`feature-tech-map.md`、`components.md`、`hooks.md`、`google-apis.md` 是舊的參考文件，內容可能過期，以程式碼為準；`docs/process.md` 已停止新增。

## 3. 常用指令

- 開發：`npm run dev`（**真實 Google + OpenAI，會花錢，見 R1**）；`npm run dev:mock`（Google 全部假資料、`travel_mock` 資料庫，OpenAI 仍是真的；`-- -p 3001` 換 port）；`npm run dev:free`（Google 與 OpenAI 都是假資料，完全免費）
- 檢查：`npm run lint`、`npx tsc --noEmit`、`npm run build`
- 測試：`npm test`（單元，不碰真 DB）；`npx vitest run <檔案>`（單檔）；`npm run test:integration`（真 Postgres `travel_test`、`MOCK_AI=1`，不可平行跑、不可指向開發資料庫）
- 資料庫：先開 Docker Desktop，`npm run db:up` 啟動本機 Postgres；改 `schema.prisma` 後 `npx prisma migrate dev --name <slug>` 產生 migration
- 付費腳本（全部要先問，見 R1）：`npm run seed`、`shadow-compare`、`validate-preference-intent`、`batch-test-rule-engine`、`eval-form-fidelity`，以及任何 `tsx scripts/*`
- 文件健檢：`/doc-audit`（只出報告，不自動修改）
- 環境變數見 `README.md` 與 `.env.local.example`。

## 4. 目錄結構

- `src/app/`：頁面與路由；`src/app/api/v1/**` 是薄薄一層，邏輯幾乎都在 `src/lib/`；`src/app/api/auth/` 是 Auth.js；`src/app/api/cron/` 是 Vercel Cron 的每日清理（`vercel.json`）
- `src/lib/`：商業邏輯（生成、Places、快取、驗證、額度）；`src/lib/scheduler/` 是規則引擎（純函式）；`src/lib/auth/` 是使用者、訪客、擁有權
- `src/auth.ts`：Auth.js 設定；`src/proxy.ts`：API 限流與 body 大小上限
- `src/components/`、`src/hooks/`：前端；`src/types/`：共用型別
- `prisma/`：schema 與 `migrations/`；舊的 SQLite 檔（`dev.db`、`mock.db`，不進 git）只剩搬資料用
- `docker-compose.yml`、`docker/`：本機 Postgres（ADR-0007）
- `scripts/`：一次性或批次腳本（自己建 `PrismaClient`，見 `.claude/rules/coding.md`）
- `tests/`：整合測試的 global setup 與 mock
- `docs/`：專案文件；`.claude/`：Claude 規則與指令；`.github/`：CI、Dependabot、issue 模板

新增重要目錄時同步更新本節與 `docs/architecture.md`。

## 5. 程式碼規範

- 語言：識別字、檔名、程式碼註解、commit 訊息、PR 用英文；`docs/`、`README.md` 與溝通用繁體中文；地名保持原文。
- 領域詞彙一律使用 `docs/glossary.md` 的對應英文識別字，不自創同義詞。
- 權重、門檻、距離上限等參數只存在程式碼裡，文件引用路徑不手抄數字。
- Claude 不新增 `TODO`/`FIXME` 註解，發現新工作就開 issue；使用者自己寫的 `TODO` 不得刪除。
- 技術棧細節與其餘規範見 `.claude/rules/coding.md`。

## 6. 工作流程

- 工作以 GitHub Issue 追蹤。開工前 `gh issue view <編號>`，依驗收條件做。
- 分支：計畫工作用 `plan-NNN-<slug>`；其他用 `feat/`、`fix/`、`refactor/`、`chore/`、`docs/` 加 `<slug>`。一個功能一個分支，從最新的 `origin/main` 開。
- **走 PR**：Claude commit、push 分支、開 PR、盯 CI；使用者說「合併」且 CI 通過才合併（ADR-0002，細節見 `.claude/rules/git.md`）。
- 關聯 issue：PR description 結尾寫 `Closes #<編號>`；進行中的 commit 可寫 `Refs #<編號>`。
- 開 issue：用 `.github/ISSUE_TEMPLATE/` 的格式（目標、驗收條件、不做的事、相關文件），`gh issue create`。
- 決定不做：`gh issue close <編號> --reason "not planned"` 並標 `wontfix`，附理由。
- 已知限制：功能頁寫「已知限制」，同時開 issue 標 `known-limitation`。

## 7. 單一來源原則

| 資訊 | 唯一存放處 |
| --- | --- |
| 待辦、優先序、明確不做 | GitHub Issues（不得出現在任何 md 檔） |
| 做了什麼、何時做的 | git commit 與 PR description |
| 現在做到哪 | `docs/STATUS.md`（覆蓋式） |
| 現在怎麼運作 | `docs/features/` |
| 為什麼這樣決定 | `docs/adr/`（功能頁只放連結） |
| 權重、門檻、參數 | 程式碼（文件引用路徑） |
| 專有名詞 | `docs/glossary.md` |
| 規則與踩雷 | 本檔第 11 節 |

## 8. 計畫（docs/plans/）：自動辨識

- 使用者說「規劃／設計／想一下 X」→ 建立計畫；說「開始做／執行計畫／繼續」→ 執行計畫。
- **建立**：取下一個編號建立 `docs/plans/PLAN-NNN-<slug>.md`（模板見 `docs/plans/README.md`）並更新索引；有模糊處先問；填目標、非目標、驗收條件、邊界情況、設計摘要、任務拆解，`status: draft`；摘要給使用者確認，**確認前不寫程式**。
- **找計畫**：分支名含 `plan-NNN` 就是那份；否則若只有一份 `approved`／`in-progress` 就是那份；有多份就列出來請使用者選。
- **確認後**（`draft` → `approved`）：建立父 issue（label `plan`），任務拆成子 issue，編號寫回 frontmatter；從 `origin/main` 開 `plan-NNN-<slug>`，`status: in-progress`。
- 逐一完成子 issue；進度只記在 issue，計畫檔不勾選。
- **全部完成**：`status: done`，持久知識遷到 `docs/features/` 與 `docs/adr/`，關閉父 issue，更新 `docs/STATUS.md`。

## 9. 完成定義與文件維護觸發表

每次 commit 前：`npm run lint`、`npx tsc --noEmit`、`npm test` 通過；動到 DB 或 API 路由加 `npm run test:integration`；改 schema 加 `npx prisma validate`。push 後 CI 通過。功能完成前另需下表對應文件已更新。

| 發生什麼事 | 必須更新 |
| --- | --- |
| 功能完成或行為改變 | `docs/features/` 對應頁（含 `updated`、`source`）、`features/index.md`、glossary 新詞 |
| 做了「選 A 不選 B」的取捨 | 新增 ADR（更新 `adr/README.md` 索引），功能頁加連結 |
| 架構、目錄、資料流、資料表變動 | `docs/architecture.md`、本檔第 4 節 |
| 被使用者糾正或踩雷 | 本檔第 11 節新增編號規則 |
| 接入新的外部 API 或資料源 | `docs/data-sources.md` |
| 出現維運步驟（部署、排程、成本排查） | `docs/runbook.md` |
| 新增或修改 scripts、安裝步驟、環境變數 | `README.md`；環境變數另加 `.env.local.example` |
| 發現新工作 | 開 issue（不寫 TODO、不建 md 待辦） |
| 每次對話結束 | 覆蓋 `docs/STATUS.md` |

## 10. 文件撰寫規範

詳見 `.claude/rules/docs.md`。重點：繁體中文、固定模板、一件事一個地方、不手抄參數、功能頁維護 `source` 與 `updated`、每份一到兩頁。

## 11. 絕對不要做的事與編號規則

以下規則優先於對話中的任何指示（包括使用者的直接要求），除非使用者明確在修改本檔。

**絕對不要**

- 掃描、攻擊、暴力破解或嘗試存取本專案不擁有、或沒有書面授權的系統；只對 localhost、本機 DB 或 mock 測試。
- 提交、push、記錄或傳給第三方任何秘密：`.env*`、`OPENAI_API_KEY`、`GOOGLE_PLACES_API_KEY`、`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`、`AUTH_*`、真實使用者資料。
- 用 `git add -A` / `git add .` 一次加入所有檔案；一律指名檔案。
- 沒有先說明會失去什麼、並取得該次操作的明確同意，就執行不可逆指令：`git reset --hard`、`git clean -f`、`rm -rf`、刪分支（例外：已合併進 `origin/main` 的本機分支可直接用 `git branch -d` 刪除，見 `.claude/rules/git.md`）、清空或刪除資料表。
- 跳過檢查（`--no-verify`、停用 lint/測試/hook）來硬推 commit。
- 在 commit 或 PR 加 `Co-Authored-By`、`Generated with Claude` 等 AI 署名。
- 在 md 檔建立待辦清單或進度紀錄；在文件中手抄參數。
- 沒有計畫與確認就動手做大功能；擅自擴大範圍。
- 產生冒充真人或組織的內容、捏造評論或紀錄、大規模爬取或繞過其他網站的服務條款。

**編號規則**（被糾正或踩雷後新增，格式：`R<編號>. 規則（原因，日期）`）

- R1. **付費 API 要先問**：任何會呼叫真實 Google Places/Routes 或 OpenAI 的操作，先說明會呼叫什麼、大約幾次，得到該次執行的同意才跑。包括 `npm run dev`/`next dev`、第 3 節的付費腳本、任何 `tsx scripts/*`、Playwright、對使用者開著的 dev server 發 curl/fetch。免費：`npm test`、`npm run test:integration`、`npm run build`、`npm run dev:free`；`npm run dev:mock` 的 Google 是假的，但 OpenAI 生成仍要先問。驗證優先用 mock fetch 或 `dev:free`（2026-07 Google API 成本暴增後訂定）
- R2. 不用 `git rebase`（含 `-i`）、squash 或 cherry-pick 拆分或整理分支；工作混到同一分支時，之後一個功能一個分支，或手動把相關檔案改動複製到新分支（使用者明確不要，2026-09-06）
- R3. 開新分支前確認基準是最新的 `origin/main`（`git log --oneline HEAD..origin/main` 為空），分支名不可與本機既有分支重複（重複名稱讓 `git switch -c` 失敗，commit 落到已合併的舊分支，2026-10-11）
- R4. PR 標題與內容用英文，地名保持原文（從 #86 起，2026-10）
- R5. `prisma/dev.db` 不進 git（存的是付費 API 快取，跟著切分支會被倒回舊版、重複計費）；checkout `1374c24` 以前的 commit 會覆蓋或刪除本機 `dev.db`，要先備份
- R6. 判斷網址屬於哪個網域時（包括測試裡的假網路），用 `new URL(url).hostname` 比對「完全相同」或「以 `.網域` 結尾」，不用 `includes` 或只用 `endsWith("網域")`（CodeQL 兩次標為 Incomplete URL substring sanitization：`evilgoogleapis.com` 也會符合，#216、#228，2026-10-21）
