# Docker 化 + CI/CD 規劃

> 狀態：規劃中（2026-10-03 建立）
> 目標：
> 1. `docker compose up` 一行指令就能跑起 **app + PostgreSQL**，任何人 clone 下來不用自己裝 DB。
> 2. GitHub Actions 把「lint / typecheck / 測試 / build / Docker image」都變成 PR 的品質關卡，main 合併後自動產出可部署的 image。

---

## 0. 現況盤點（2026-10-03 看過程式碼）

### CI 其實已經有一半了 ✅
`.github/workflows/ci.yml`（`095e3fa` 起）在 push / PR 到 main 時已經跑：

| 步驟 | 狀態 |
|---|---|
| `npm ci` + npm cache | ✅ |
| `npm audit --omit=dev --audit-level=high` | ✅ |
| `prisma generate` | ✅ |
| `npm run lint` | ✅ |
| `npm test`（unit） | ✅ |
| `npm run test:integration`（SQLite `test.db`、`MOCK_AI=1`） | ✅ |
| `npm run build` | ✅ |
| Dependabot（npm 每週、actions 每月） | ✅ |

**缺的是：**
- 沒有獨立的 **typecheck** 步驟。`next build` 會順便檢查型別，但錯誤混在 build log 裡、而且要等 build 跑到那一步才會失敗。`npx tsc --noEmit` 目前在 main 上是乾淨的（2026-10-03 實測 exit 0），可以直接加上去不用先修錯。
- 全部擠在一個 job，任何一步失敗後面都不跑，看不出「是 lint 壞還是 build 壞」。
- **沒有 CD**：沒有 Docker image、沒有發佈到任何 registry、沒有部署。
- main 沒有設 branch protection（CI 紅燈仍可合併）——這要在 GitHub repo 設定裡開，不是程式碼。

### Docker 完全沒有 ❌
沒有 `Dockerfile`、`docker-compose.yml`、`.dockerignore`。

### 最大的工作量其實在「SQLite → PostgreSQL」⚠️
`prisma/schema.prisma` 是 `provider = "sqlite"`。Prisma 的 provider **不能用環境變數切換**，所以「compose 裡放 Postgres」等於整個專案（本機開發、integration test、`dev:mock`、CI）都要換成 Postgres。好消息是程式碼面風險很低：

- 沒有任何 `$queryRaw` / `$executeRaw`（grep 過 `src/`、`scripts/`）。
- 沒有 `contains` / `startsWith` 字串篩選 → 不會踩到「SQLite 不分大小寫、Postgres 分大小寫」的差異。
- JSON 欄位都是 `String` + 手動 `JSON.parse/stringify`（`src/lib/db.ts` 的 extension、各 `*Cache` 表）→ 在 Postgres 會變成 `text`，行為不變。**這次先不改成原生 `Jsonb`**，避免動到 `db.ts` 和 11 支自己 new `PrismaClient` 的 scripts。
- `assertMockPlacesDatabase()` 是檢查 `DATABASE_URL` 有沒有 `mock` 字樣 → Postgres 的 DB 取名 `travel_mock` 就照樣成立。

**真正要小心的是 `prisma/dev.db` 裡的付費快取資料**（Places、各種 `*Cache` 表）。直接換 DB 等於快取全部歸零，下次生成行程會重新付錢打 Google（參考 `plan/google-api-cost-spike-2026-07.md`）。所以必須有一步「把 SQLite 資料搬進 Postgres」。

### 工作量重估
原本估「一兩天」是只算 Dockerfile + workflow。加上 Postgres 遷移，實際大約 **3～3.5 天**：

| Phase | 內容 | 估時 | 分支 |
|---|---|---|---|
| A | CI 補強（typecheck、拆 job、branch protection） | 0.5 天 | `ci/split-jobs-typecheck` |
| B | SQLite → PostgreSQL（含快取資料搬遷） | 1～1.5 天 | `feat/postgres` |
| C | Dockerfile + docker-compose | 1 天 | `feat/docker` |
| D | CD：build & push image 到 GHCR | 0.5 天 | `ci/docker-image` |

A 跟其他三個完全獨立，可以先做先合。B → C → D 有先後順序。每個 Phase 一個分支、一個 PR（不 rebase / cherry-pick 拆分）。

> 如果時間真的只有一兩天：先做 A + C（compose 裡只有 app，SQLite 掛 volume），B 之後再補。但這樣就**不能**說「有 app + postgres 的 compose」，只能說「有 Docker 化」。建議還是走完 B，因為 SQLite 本來就是正式部署的阻礙（serverless 不能寫檔、多實例不能共用），之後 `plan/security-hardening.md` Phase 2 部署前遲早要換。

---

## Phase A — CI 補強（0.5 天）

### 改動
1. `package.json` 加 `"typecheck": "tsc --noEmit"`。
2. `ci.yml` 拆成平行的 job：

```
quality      : npm ci → audit → prisma generate → lint → typecheck → unit test
integration  : npm ci → prisma generate → test:integration
build        : npm ci → prisma generate → next build
```

3. 加 `concurrency`（同一個 PR 推新 commit 時取消舊的 run，省 Actions 分鐘數）：
   ```yaml
   concurrency:
     group: ci-${{ github.ref }}
     cancel-in-progress: true
   ```
4. 頂層加 `permissions: contents: read`（最小權限，Phase D 才在單一 job 開 `packages: write`）。
5. 佔位 key（`sk-ci-placeholder` 等）保留：`src/lib/openai.ts` 在 import 時就檢查 `OPENAI_API_KEY`，build 時沒有會直接爆。CI 永遠不放真 key —— 測試不該打付費 API。

### 手動設定（GitHub 網頁，自己做）
- Settings → Branches → main 加 rule：Require status checks（勾 `quality`、`integration`、`build`）、Require PR before merging。

### 驗收
- 開一個 PR，三個 job 平行跑、全綠。
- 故意在某個檔案寫錯型別推上去 → `quality` 的 typecheck 紅燈、PR 不能合併 → revert。

---

## Phase B — SQLite → PostgreSQL（1～1.5 天）

### B1. 先準備本機 Postgres
這一步先只寫 compose 的 `db` service（Phase C 再加 app），讓本機開發有 Postgres 可以用：

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: travel
      POSTGRES_PASSWORD: travel        # 只在本機用；正式環境另外給
      POSTGRES_DB: travel
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U travel"]
      interval: 5s
      retries: 10
volumes:
  pgdata:
```

用 init script（`docker/postgres-init.sql`）在同一個 container 多建兩個 DB：`travel_test`（integration test）、`travel_mock`（`dev:mock`）。

### B2. 換 provider、改用 migrations
1. `schema.prisma`：`provider = "postgresql"`。
2. 目前一直用 `prisma db push`，沒有 migration 歷史。改成 `npx prisma migrate dev --name init` 產出 `prisma/migrations/`（要 commit）。之後 container 啟動用 `prisma migrate deploy`，這是正式環境的標準做法，`db push` 只適合開發。
3. 看一遍產出的 SQL：`String` 都是 `TEXT`、`DateTime` 是 `TIMESTAMP(3)`、`@@index` 都有建起來。

### B3. 改所有寫死 SQLite 路徑的地方
| 檔案 | 現在 | 改成 |
|---|---|---|
| `.env`（自己改，不進 git） | `file:./dev.db` | `postgresql://travel:travel@localhost:5432/travel` |
| `.env.local.example` | 註解寫 `file:./test.db` | 改成 Postgres 範例 |
| `vitest.integration.config.mts` | `DATABASE_URL: "file:./test.db"` | `postgresql://…/travel_test`（可被 `TEST_DATABASE_URL` 覆寫，給 CI 用） |
| `tests/integration/global-setup.ts` | `db push` 到 `file:./test.db` | 對 `travel_test` 跑 `prisma migrate reset --force --skip-seed`（每次乾淨的 schema） |
| `scripts/dev-mock.mjs` | `file:./mock.db` | `postgresql://…/travel_mock`（名稱有 `mock`，保護機制照常運作） |
| `.github/workflows/ci.yml` | `file:./dev.db` | integration job 加 `services: postgres`，build job 不需要真的 DB |
| `CLAUDE.local.md`、`README.md`、`docs/database.md` | 寫 SQLite | 更新 |

`.gitignore` 的 `/prisma/*.db*` 規則保留，舊的 SQLite 檔還會在本機留一陣子當備份。

### B4. 搬付費快取資料（最重要的一步）
1. **先備份**：複製 `prisma/dev.db` → `prisma/dev.db.backup-YYYYMMDD`。
2. 對空的 `travel` DB 跑 `prisma migrate deploy` 建好表。
3. 用 [pgloader](https://pgloader.io/)（跑 Docker image，不用裝）以 **data only** 模式把 SQLite 資料倒進已經建好的表：
   ```
   LOAD DATABASE FROM sqlite:///data/dev.db INTO postgresql://travel:travel@db/travel
   WITH data only, reset sequences;
   ```
   不讓 pgloader 自己建表，表結構以 Prisma migration 為準。
4. 驗證：寫一個小 script 比對兩邊每張表的 row count；開幾個舊行程確認地點、照片、快取都還在（用 `npm run dev:mock` 先看畫面，真的 `npm run dev` 要先確認會打哪些 API）。
5. 注意點：SQLite 的 `DateTime` 可能是 epoch 毫秒數字或字串，pgloader 轉換時要確認時間沒有跑掉（抽查幾筆 `createdAt`）。

> 如果 pgloader 對型別轉換不配合，備案是寫一個 one-off `tsx` script：用 `prisma generate --schema` 另外產一個指向舊 SQLite schema 的 client（`output` 到別的資料夾），逐表讀出再 `createMany` 寫進 Postgres。

### 驗收
- `npm test`、`npm run test:integration`（對本機 `travel_test`）、`npm run build` 全過。
- `npm run dev:mock` 能開、資料寫進 `travel_mock`。
- 每張表 row count 兩邊一致；舊行程打開來快取命中、沒有多打 Google（看 server log 的 cache hit）。
- CI 的 integration job 在 Postgres service container 上全綠。

### 回滾
schema、設定都在 `feat/postgres` 分支上，`dev.db` 有備份。放棄的話切回 main、`.env` 改回 `file:./dev.db` 即可，不會掉資料。

---

## Phase C — Dockerfile + docker-compose（1 天）

### C1. `next.config.ts` 加 `output: "standalone"`
Next 會把真正需要的檔案 trace 到 `.next/standalone/`，image 不用帶整包 `node_modules`，大小差好幾倍。

### C2. `Dockerfile`（multi-stage）

```dockerfile
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 瀏覽器端的 key 會在 build 時被 inline 進 JS，只能用 build arg 給
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
# openai.ts 在 import 時檢查 key；只是讓 build 通過，這個 stage 不會進最終 image
ENV OPENAI_API_KEY=build-placeholder GOOGLE_PLACES_API_KEY=build-placeholder
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

設計重點：
- **base 用 `bookworm-slim` 不用 `alpine`**：Prisma 5 在 alpine（musl）要另外設 `binaryTargets`，slim 比較不會踩雷；builder 跟 runner 同一個 base，engine 一定對得上。
- **非 root 使用者**跑 app。
- **伺服器端的 secret（`OPENAI_API_KEY`、`GOOGLE_PLACES_API_KEY`）絕對不寫進 Dockerfile 的 `ARG`/`ENV`**，只在 runtime 由 compose 的 `env_file` 注入。builder stage 的 placeholder 不會進最終 image。
- `NEXT_PUBLIC_*` 本來就會送到瀏覽器（有 HTTP referrer 限制），但 build 進 image 之後，**image 推到公開 registry 就等於公開這個 key** → Phase D 的 GHCR package 要設 private，或 CI build 時不帶這個 arg。
- 要驗證的風險：standalone trace 有沒有把 `.prisma/client` 的 query engine 一起帶進去。沒有的話 runner 要另外 `COPY node_modules/.prisma`。

### C3. migration 用獨立的一次性 service
standalone image 裡沒有 Prisma CLI，所以不在 app 啟動時跑 migrate，而是另開一個用 `builder` target 的 service：

```yaml
services:
  db:        # 同 Phase B1
  migrate:
    build: { context: ., target: builder }
    command: npx prisma migrate deploy
    environment:
      DATABASE_URL: postgresql://travel:travel@db:5432/travel
    depends_on:
      db: { condition: service_healthy }
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: ${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
    env_file: .env
    environment:
      DATABASE_URL: postgresql://travel:travel@db:5432/travel   # 覆蓋 .env 裡的 localhost
    ports: ["3000:3000"]
    depends_on:
      migrate: { condition: service_completed_successfully }
```

再加一個 `docker-compose.mock.yml` override：`MOCK_PLACES=1` + DB 指向 `travel_mock`。用法 `docker compose -f docker-compose.yml -f docker-compose.mock.yml up`，跟 `npm run dev:mock` 對應，點畫面不燒 Google 額度（OpenAI 一樣是真的）。

### C4. `.dockerignore`（跟 Dockerfile 一樣重要）
```
.env*
!.env.local.example
prisma/*.db*
node_modules
.next
.git
.github
.claude
CLAUDE.local.md
coverage
*.tsbuildinfo
_scratch*
```
**`.env*` 和 `prisma/*.db*` 一定要排除** —— 否則 `COPY . .` 會把真 key 和付費快取 DB 打包進 image。

### C5. 其他
- rate limit 目前是 in-memory（`plan/security-hardening.md` Phase 1b），單一 container 沒問題；之後要多個 replica 再換 Redis。
- README 加「用 Docker 跑」一節。

### 驗收
- `docker compose build` 成功（免費，不打 API）。檢查 image 大小、`docker history` 確認沒有 `.env` / `.db`：
  `docker run --rm <image> ls -la /app` 看不到 `.env`、`prisma/*.db`。
- `docker compose -f docker-compose.yml -f docker-compose.mock.yml up` → 打開 localhost:3000 能看到首頁、舊行程（**生成新行程會打 OpenAI，要先確認**）。
- `docker compose down` 再 `up`，資料還在（volume 有生效）。
- 用真 key 的 `docker compose up` 屬於付費操作，照規則先確認再跑。

---

## Phase D — CD：build & push image（0.5 天）

### 改動
`ci.yml` 加一個 `docker` job，`needs: [quality, integration, build]`：

- **PR**：只 `docker build`（`push: false`），確保 Dockerfile 沒被改壞。
- **push 到 main**：build 並推到 GitHub Container Registry（`ghcr.io/wanyiyeh/ai-travel-agent`），tag 用 `sha-<short>` + `latest`。
- 用 `docker/setup-buildx-action` + `docker/build-push-action`，`cache-from/cache-to: type=gha` 讓重複 build 快很多。
- 只有這個 job 開 `permissions: packages: write`，用內建的 `GITHUB_TOKEN` 登入 GHCR，不需要新增任何 secret。
- **不帶 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` build arg**（CI 也沒有這個 key）→ 這個 image 的地圖不會動，它的用途是證明「每次合併都會產出可部署的 artifact」。真正部署時再在部署平台 build，或把 package 設 private 後再帶 key。

### 刻意不做的部分
**自動部署到某個主機**先不做：`plan/security-hardening.md` Phase 2（存取控制）還沒做，目前所有 API 公開、任何人都能刪行程，公開部署會直接變成燒錢入口。等決定部署目標（VM vs. 平台）+ 做完存取控制再加 deploy job。

### 驗收
- PR 上 `docker` job 只 build 不 push。
- 合併到 main 後，repo 的 Packages 頁看得到新 image；`docker pull` 下來配上 compose 的 `db` 能跑。

---

## 完成後的現況描述（準確版）

做完 A～D 之後，能誠實說的是：

- **Docker**：有 multi-stage Dockerfile（standalone、非 root、secret 只在 runtime 注入）和 docker-compose（app + PostgreSQL + 一次性 migration service），另有 mock 模式 override 讓本機點 UI 不燒 API 費用。
- **CI**：每個 PR 平行跑 lint、typecheck、unit test、integration test（Postgres service container）、production build、依賴漏洞掃描、Docker build；main 有 branch protection，紅燈不能合併。
- **CD**：main 合併後自動 build 並推 image 到 GHCR。**還沒有自動部署到正式環境** —— 原因是存取控制還沒做完，這是刻意的取捨，不是沒想到。
- **資料庫遷移**：從 SQLite 換到 PostgreSQL，改用 Prisma migrations，並把付費 API 的快取資料完整搬過去（避免換 DB 後重複計費）。

最後一點加上「CI 擋品質、快取避免重複計費」，比單純「有寫 Dockerfile」更能說明對成本跟維運的考量。

---

## 待決定

- [ ] 時間不夠時要不要先做「A + C（SQLite 版）」？（建議：不要，直接走 B）
- [ ] JSON 欄位之後要不要改成原生 `Jsonb`？（這次不做，列為後續）
- [ ] 部署目標（VM / Fly.io / Railway / Render…）→ 影響 Phase D 之後的 deploy job、rate limit 要不要換 Redis。
