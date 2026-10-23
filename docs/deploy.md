# 部署（Vercel + Neon）

第一次上線的設定步驟（PLAN-001 #213，[ADR-0003](adr/0003-vercel-and-neon.md)）。帳號操作由使用者在各網站完成；秘密只填進各平台，不寫進任何檔案或對話。

## 0. 先做

- GitHub 開啟兩步驟驗證（Vercel 用 GitHub 登入，就跟著受保護）。
- 本機 `.env` 能跑 `npm run dev:free`，`npm run build` 通過。

## 1. Neon（資料庫）

1. 用 GitHub 登入 [Neon](https://neon.com)，建立專案：名稱 `ai-travel-agent`、Postgres 16、地區 **AWS Asia Pacific (Singapore)**。地區建立後不能改。
2. 預設資料庫改名或新建為 `travel`（正式環境）；再新建一個 `travel_mock`（preview 用，名稱要含 `mock`，`MOCK_PLACES` 才肯用）。
3. 在 Connect 視窗各複製兩種連線字串：
   - **Pooled**（主機名稱有 `-pooler`）：給 Vercel 執行時用，後面加上 `&connect_timeout=15&pgbouncer=true`（免費方案閒置 5 分鐘會休眠，第一次連線較慢）。
   - **Direct**（沒有 `-pooler`）：只給本機跑 migration 用。
4. 在本機套用資料表結構（用 Direct 字串，兩個資料庫各跑一次）：
   ```bash
   DATABASE_URL="<travel 的 direct 字串>" npx prisma migrate deploy
   DATABASE_URL="<travel_mock 的 direct 字串>" npx prisma migrate deploy
   ```

之後每次有新的 migration：先對 Neon 跑 `migrate deploy`，再合併要用到它的程式。Migration 要向前相容（舊程式在新結構上也能跑），因為 Vercel 可以退回上一版程式，但不會退回 migration。

## 2. Vercel（網站）

1. 用 GitHub 登入 [Vercel](https://vercel.com)（Hobby）。安裝 Vercel 的 GitHub App 時選 **Only select repositories → `ai-travel-agent`**。
2. Add New → Project → 匯入這個 repo，Framework 會自動選 Next.js。**先不要按 Deploy**，先設環境變數（Settings → Environment Variables，依環境分開填）：

| 變數 | Production | Preview |
| --- | --- | --- |
| `DATABASE_URL` | `travel` 的 pooled 字串 | `travel_mock` 的 pooled 字串 |
| `OPENAI_API_KEY` | 真的 key | 不設 |
| `GOOGLE_PLACES_API_KEY` | 真的 key | `mock-not-used`（mock 模式不會送出） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | 瀏覽器 key | 不設（preview 的地圖與地點詳情不載入，避免計費） |
| `AUTH_SECRET` | 新產生一組 | 另產生一組 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | OAuth 用戶端 | 不設（preview 只能用訪客身分） |
| `ADMIN_EMAILS` | 自己的 email | 不設 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Turnstile 的 key | Cloudflare 的測試 key（`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`，永遠通過） |
| `CRON_SECRET` | 新產生一組 | 不設 |
| `MOCK_AI` / `MOCK_PLACES` | 不設 | `1` / `1` |

   產生隨機字串：`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`。

3. Deploy。函式地區由 `vercel.json` 的 `regions` 設成新加坡（`sin1`），部署後在 Settings → Functions 確認。
4. Settings → Deployment Protection → **Vercel Authentication：Standard Protection**（preview 要登入 Vercel 才能看，正式網址公開）。

## 3. 正式網域

部署完成後拿到網址（例如 `https://<專案>.vercel.app`），到下面三處加上它：

- **Google OAuth 用戶端**（Google Auth Platform → 用戶端）：已授權的 JavaScript 來源加 `https://<網域>`；重新導向 URI 加 `https://<網域>/api/auth/callback/google`。
- **瀏覽器 Maps key**（API 和服務 → 憑證 → browser-maps-js）：網站限制加 `https://<網域>/*`。
- **Cloudflare Turnstile**：widget 的 Hostname 加 `<網域>`。

## 4. 上線後檢查

- 打開首頁、以訪客生成一次行程（會花真的錢，約 US$0.3～0.5）、用 Google 登入一次。
- Settings → Cron Jobs 看到 `/api/cron/daily`，按一次 Run，回應是各項刪除筆數。
- 本機對正式資料庫跑稽核：`DATABASE_URL="<travel 的 direct 字串>" npm run audit-google-content`，應為 0。

## 5. 每日配額與方案上限

**GCP 每日配額**（API 和服務 → 各 API → 配額）是最後一道防線，以請求次數設定。下表依全站每日生成上限（`src/lib/quota.ts` 的 `QUOTAS`）與 [runbook](runbook.md) 的量測，留 1.5 倍餘裕：

| API／方法 | 一天大約會用到 | 建議每日配額 | 全部照價收費的最壞情況 |
| --- | --- | --- | --- |
| Places：SearchNearby | 每次生成 6～11 次 | 300 | 約 US$10.5 |
| Places：SearchText | 每次生成約 10 次，多數是免費的 IDs Only | 300 | 約 US$9.6 |
| Places：GetPlace | 找地點的座標＋看行程時補名稱 | 800 | 約 US$13.6 |
| Places：GetPhotoMedia | 候選清單的縮圖 | 300 | 約 US$2.1 |
| Routes：ComputeRouteMatrix | 每次生成約 10 個元素 | 400 | 約 US$2 |

「最壞情況」要所有每月免費額度都用完、而且每項每天都打滿才會發生；作品集的流量通常整個月都在免費額度內。更精確的「每天最多付多少錢」由 app 自己計算（#255）。預算通知與 OpenAI 硬上限見 #181。

**方案上限**：

- **Vercel Hobby**：每月含 1,000,000 次函式呼叫、4 CPU 小時、100 GB 傳輸等；超過時該功能要等 30 天後才能再用，不會收費。限非商業用途，放廣告或收費前要升級 Pro（ADR-0003）。
- **Neon Free**：每月 100 CU 小時、每個專案 1 GB 儲存；用完時資料庫暫停到下個週期。閒置 5 分鐘後休眠，第一個請求較慢。
- **Vercel Cron（Hobby）**：每天一次，實際執行時間落在指定的那一小時內，偶爾會重複觸發（清理可重複執行，不影響）。
