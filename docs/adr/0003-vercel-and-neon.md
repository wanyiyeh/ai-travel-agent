# ADR-0003：作品集上線使用 Vercel + Neon（Postgres），兩者都在新加坡

日期：2026-10-20
狀態：Proposed

## 背景

作品集要一個可以公開點開的網址。目前的架構假設「單一 process、檔案會保留」：資料庫是 SQLite 檔，限流、全站每日熔斷、同時生成鎖都存在記憶體。`generate-stream` 會串流數十秒。使用者在台灣，之後也可能營利。

## 決策

- 部署到 Vercel（先用 Hobby 方案），資料庫改用 Neon 託管的 Postgres（先用免費方案）。
- 兩者都放在新加坡：Neon 沒有東京區域，而且專案建立後不能改區域。
- 記憶體裡的限流、熔斷、同時生成鎖改存 Postgres，不另外加 Redis。
- 正式環境與 preview 環境使用不同的資料庫與 key；preview 部署開啟保護。

## 考慮過的替代方案

- 單機 + SQLite（Fly.io、Railway、自己的 VM）：改動最少，記憶體狀態照樣正確；但只能跑一台、要自己做備份，作品集上看不到 Postgres。
- 先遷 Postgres、部署到容器平台：不受函式時間上限影響，但要自己維運容器。
- 共用狀態用 Upstash Redis：最適合計數，但多一個服務與 secret；流量小時 Postgres 就夠。

## 後果

- 要做 SQLite → Postgres 遷移，以及建立 migration 歷史；整合測試改用 Postgres，CI 要加 Postgres service（workflow 由使用者 push，ADR-0002）。
- 函式有時間上限，生成的重試與 fallback 必須落在上限內；長期解法是背景工作（營利階段再做）。
- Neon 免費方案閒置 5 分鐘會暫停，閒置後的第一個請求較慢。
- Vercel Hobby 限非商業用途；放廣告、聯盟連結或收費前要升級 Pro。
- Google 的伺服器 key 無法用 IP 限制（Vercel 沒有固定出口 IP），只靠 API 限制與每日配額。

## 相關

[PLAN-001](../plans/PLAN-001-portfolio-launch.md)、[ADR-0004](0004-google-maps-content-storage.md)、`plan/docker-and-ci.md`
