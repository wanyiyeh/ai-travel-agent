# ADR-0007：本機開發與整合測試用 Docker 跑 Postgres，CI 用 Postgres service

日期：2026-10-23
狀態：Accepted

## 背景

依 [ADR-0003](0003-vercel-and-neon.md)，正式環境改用 Neon 的 Postgres。Prisma 一份 schema 只能有一種資料庫，所以本機開發、`dev:mock`／`dev:free` 與整合測試也要改用 Postgres，不能繼續用 SQLite 檔。使用者的電腦已裝 Docker Desktop。

## 決策

- 本機用 `docker-compose.yml` 跑一個 `postgres:16-alpine`，裡面三個資料庫：`travel`（`npm run dev`）、`travel_mock`（`dev:mock`、`dev:free`）、`travel_test`（整合測試）。帳號密碼只在本機使用。`npm run db:up` 啟動。
- 資料表結構改用 `prisma migrate` 管理（`prisma/migrations/`），不再用 `db push`。整合測試每次用 `migrate reset` 重建 `travel_test`，順便驗證 migration。
- CI 的 workflow 加一個 Postgres service，整合測試連 `travel_test`（workflow 由使用者 push，ADR-0002）。
- 現有 SQLite（`dev.db`、`mock.db`）的資料用腳本搬到 `travel` 與 `travel_mock`。
- JSON 欄位（`Itinerary.days`、`config` 等）先維持字串，`src/lib/db.ts` 的轉換不變。

## 考慮過的替代方案

- **本機也連 Neon 的開發分支**：不用開 Docker；但開發與測試都要網路、整合測試較慢，而且會用掉免費方案的運算時數。
- **本機繼續 SQLite、正式用 Postgres**：Prisma 一份 schema 只能有一種 provider，要維護兩份 schema 或在建置時切換，兩邊行為（大小寫、排序、型別）也會不一致。

## 後果

- 開發前要先開 Docker Desktop；沒開時 `npm run dev`、`dev:free` 與整合測試都連不上資料庫。
- 改 `schema.prisma` 後要用 `npx prisma migrate dev --name <slug>` 產生 migration 並 commit。
- 原生 SQL 的資料表名稱要加雙引號（Postgres 會把沒加引號的名稱轉成小寫）。
- 本機資料存在 Docker volume（`pgdata`），`docker compose down -v` 會刪掉；備份用 `pg_dump`（`docs/runbook.md`）。

## 相關

- [ADR-0003](0003-vercel-and-neon.md)、PLAN-001 任務 15（#208）
- `docker-compose.yml`、`docker/postgres-init.sql`、`prisma/migrations/`、`tests/integration/global-setup.ts`、`scripts/dev-mock.mjs`
