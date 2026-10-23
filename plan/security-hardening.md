# 資安強化（Security Hardening）

> 狀態：已完成並封存（2026-10-23）。這頁說明目前有哪些防護、放在哪裡；後續工作在 GitHub Issues（label `security`），不寫在這裡。參數以程式碼為準。

## 威脅模型

這個專案沒有金流，最有價值的是**付費 API 額度**（OpenAI、Google Places／Routes），其次是使用者的行程資料。優先順序：成本濫用防護 → 存取控制 → 一般 Web 防護。

| 對象 | 想做什麼 | 對應的防護 |
|---|---|---|
| 大量打 API 的腳本 | 讓帳單暴增 | 輸入上限、限流、每日額度、全站每日上限、雲端配額 |
| 把後端當免費代理 | 用我們的 key 查自己的東西 | 限流、照片路由只接受合法的照片名稱 |
| 存取別人的資料 | 讀、改、刪別人的行程 | 登入與擁有權檢查、跨站寫入阻擋 |
| 提示注入 | 操控 AI 輸出 | 使用者輸入以不可信任資料包裝、輸出經 zod 驗證並以純文字呈現 |
| 找金鑰 | 盜用 key | 伺服器 key 不給瀏覽器、瀏覽器 key 限網域與 API |

## 目前的防護

**雲端主控台**
- 瀏覽器 key 與伺服器 key 分開，各自只開需要的 API；瀏覽器 key 限網域。
- GCP 每日配額、預算警示；OpenAI 只開允許的模型並設花費上限（#181）。

**成本（程式層）**
- 輸入上限：天數、文字長度、陣列長度、request body 大小（`src/lib/inputLimits.ts`、`src/lib/schemas.ts`、`src/proxy.ts`）。
- 每個 IP 依成本等級限流、全站每日呼叫上限、同一 IP 同時只能一個生成；存在 Postgres，多個伺服器實例共用（`src/lib/rateLimit.ts`、`src/lib/dailyBudget.ts`、`src/lib/sharedState.ts`）。
- 依使用者、IP、裝置計算的每日額度（`src/lib/quota.ts`）；生成前 Cloudflare Turnstile。
- 所有 Google 呼叫經過 `src/lib/googleFetch.ts`；照片路由的 key 放在 header、只接受屬於該地點的照片名稱（`src/lib/placePhotoName.ts`）。
- 生成有時限，超過就停下並告知使用者（`src/app/api/v1/generate-stream/route.ts`）。

**存取控制**
- Google 登入與簽章的訪客 cookie，每支路由檢查行程擁有權，別人的行程回 404（`src/lib/auth/`）。
- 跨站送來的寫入請求在 `src/proxy.ts` 擋下；每日清理路由以 `CRON_SECRET` 保護。

**AI**
- 使用者輸入以 `src/lib/untrustedInput.ts` 包裝並放在 user message；輸出一律 zod 驗證、純文字呈現。

**Web**
- 安全標頭與 CSP（`src/lib/securityHeaders.ts`）；不設 CORS。
- 內部錯誤只寫進伺服器 log，回應只帶 `requestId`（`src/lib/apiError.ts`）。

**依賴與流程**
- CI 跑 `npm audit`（會出貨的依賴有 high 以上漏洞就失敗）、Dependabot、CodeQL、Secret scanning 與 Push protection、`main` 分支保護（ADR-0002）。

## 驗證原則

只對 localhost、本機資料庫與 mock 測試（`CLAUDE.md` 第 11 節）。各項防護的行為由單元與整合測試涵蓋。
