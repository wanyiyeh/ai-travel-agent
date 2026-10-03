# 資安強化規劃（Security Hardening Plan）

> 狀態：規劃中（2026-09-29 建立）
> 目標：在專案公開部署前，擋下「別人惡意使用」會造成的三類損害 —— **燒錢**、**資料被改/被刪**、**金鑰外洩**。

---

## 0. 威脅模型：誰會攻擊、他想要什麼

這個專案沒有金流、沒有真實使用者個資，最有價值的東西其實是 **付費 API 額度**（OpenAI、Google Places/Routes）。所以優先順序跟一般網站不太一樣：

| 攻擊者 | 目的 | 對本專案的實際傷害 |
|---|---|---|
| 腳本小子 / 爬蟲 | 大量打 API | 每次 `generate-stream` 都觸發 OpenAI + 多次 Google 呼叫 → **帳單暴增**（見 `plan/google-api-cost-spike-2026-07.md`，這類事已經發生過一次，而且是自己打的） |
| 白嫖者 | 把你的後端當免費代理 | 用 `/places/search`、`/places/[id]/photo` 查自己要的東西，Google 帳單算你的 |
| 惡作劇者 | 破壞 | 目前沒有登入，任何人知道 itinerary id 就能 `DELETE` / 改行程 |
| 提示注入者 | 操控 AI | 在「風格描述」裡塞指令，讓模型輸出不當內容或超長回應 |
| 找金鑰的人 | 偷 key 拿去別處用 | 瀏覽器端的 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` 本來就公開，若沒設限制就能被盜用 |

**結論：第一優先是「成本濫用防護」，第二是「存取控制」，第三才是傳統 Web 漏洞。**

---

## 1. 目前現況盤點（2026-09-29 掃過程式碼）

### 已經做對的事 ✅
- `.env*`、`*.pem`、`prisma/dev.db` 都在 `.gitignore`。
- `GOOGLE_PLACES_API_KEY` 只在伺服器端使用；照片走 `/api/v1/places/[placeId]/photo` 代理，不把 server key 給瀏覽器。
- 所有 Google 呼叫集中在 `src/lib/googleFetch.ts`，方便之後加限流/記帳。
- 多數寫入路由已用 zod 驗證 body（12 支路由）。
- 沒有使用 `dangerouslySetInnerHTML`，React 預設跳脫輸出，XSS 面小。
- 已有多層快取（Place cache、各種 `*Cache` 表），重複請求不會重複計費。
- `exchange-rate` 路由有嚴格的 `^[A-Z]{3}$` 驗證。

### 發現的風險 ⚠️

| # | 風險 | 位置 | 嚴重度 |
|---|---|---|---|
| R1 | **完全沒有身分驗證**，所有 API 公開；`DEMO_USER_ID` 寫死 | 全部 `src/app/api/v1/**` | 高 |
| R2 | **任何人可刪除/修改任何行程**（IDOR），而且 `/itineraries` 頁面會列出所有 id | `itinerary/[id]/route.ts` `DELETE`、各 days/stops 路由 | 高 |
| R3 | **沒有 rate limit**，一個 script 就能無限觸發 OpenAI + Google | 全部，特別是 `generate-stream`、`*/regenerate`、`stop-suggestions`、`restructure`、`enrich-*` | 高 |
| R4 | **生成天數沒有伺服器端上限**：`calcDays()` 只取 `returnDate - departureDate`，送一個 365 天的行程就會產生巨大的 prompt/token 與 Google 查詢 | `src/lib/itineraryGen.ts:25`、`generate-stream/route.ts` | 高 |
| R5 | **`prompt`（風格描述）沒有長度限制也沒過 schema**，直接拼進給 OpenAI 的訊息 → 提示注入 + token 成本放大 | `generate-stream/route.ts:233` | 中高 |
| R6 | **照片路由把 `?name=` 直接拼進 Google URL 路徑**（`${PLACES_API_BASE}/${photoName}/media?...&key=`），可被塞 `../` 或其他路徑，讓伺服器帶著你的 key 去打非預期的 Google 端點 | `places/[placeId]/photo/route.ts` | 中高 |
| R7 | 照片路由的 `photoUriCache` 是**無上限的 in-memory Map**，大量不同的 `name` 會吃光記憶體 | 同上 | 中 |
| R8 | `/places/search` 等於一個**公開的 Google Text Search 代理** | `places/search/route.ts` | 中 |
| R9 | 錯誤回應帶 `details: String(error)`，可能洩漏內部訊息（Prisma 錯誤、檔案路徑、上游 API 訊息） | 約 10 支路由的 catch 區塊 | 低中 |
| R10 | `next.config.ts` 是空的 —— 沒有安全標頭（CSP、X-Frame-Options 等） | `next.config.ts` | 低中 |
| R11 | `departureDate`/`returnDate` 只驗 `min(1)`，不是真正的日期格式；陣列欄位（`interestBoost` 等）沒有長度上限 | `src/lib/schemas.ts` | 低 |
| R12 | ~~瀏覽器與伺服器共用同一把 Google key（`.env` 兩個變數值相同），且 Application restrictions = None、API restrictions = 預設 32 APIs~~ → 2026-09-29 已拆成兩把 key 並各自限縮，見 Phase 0 | GCP Console | ✅ 已處理 |
| R13 | 2026-09 當月 Google 花費 **NT$3,029**（約 US$95，帳單幣別是新台幣；預算是 NT$500），預算警示有設但**沒收到通知**。來源已查明：98% 是 Text Search Enterprise（3,678 次），因為 field mask 含 `rating`/`priceLevel`，見 Phase 0 | GCP Billing | 中・費用已修、通知待處理 |

---

## 2. 分階段計畫

### Phase 0 — 雲端主控台設定（不用改程式，最快見效，先做）

這些是「就算程式有洞，損失也有上限」的保險。

- [x] **Google Cloud：預算警示** — 已有「$500 每月預算警告」（50% / 90% / 100% / 150%），「Email alerts to billing admins and users」已勾。
- [ ] **預算通知沒收到的問題**（R13）：
  - [ ] 勾「Link Monitoring email notification channels」，直接指定自己的 email，不依賴 billing admin 權限。
  - [ ] 確認 Billing Account Administrator 是哪個帳號；Gmail 搜 `from:CloudPlatform-noreply@google.com`（含垃圾郵件）。
  - [ ] 預算只會通知、不會擋花費 → 評估設定 spend cap。
- [x] **查明 2026-09 的 NT$3,029**（R13，2026-10-02）：Billing 報表依 SKU 拆分 —— Text Search Enterprise 3,678 次 = NT$2,971（98%）、Place Details Photos 1,262 次 = NT$58，其餘都在免費額度內。用美元單價反推（扣每月免費 1,000 次後 ×$35/千、×$7/千）兩項都對上約 31.7 的匯率，確認帳單幣別是新台幣；稅金 151 = 5% 營業稅。成因：`placesTextSearch.ts` 的 field mask 含 Enterprise 欄位 `rating`/`priceLevel`，整個請求都按 Enterprise 計費。修法（分支 `fix/text-search-pro-tier`）：field mask 降到 Pro（每月 5,000 次免費），`upsertPlace` 不再用「沒抓評分」蓋掉既有評分。網站未部署、用量型態符合自己的 enrich/搜尋，不是 key 被盜用。
- [x] **Google Cloud：每日配額上限**（2026-10-02 已設）— APIs & Services → Places API (New) / Routes API → Quotas，把每日請求數設成合理值（例如預期用量的 2–3 倍）。超過直接失敗，而不是繼續扣錢。
- [x] **拆成兩把 key**（2026-09-29）— 原本 `.env` 的兩個變數是同一把 key，瀏覽器可看到且可呼叫 Places/Routes。
- [x] **瀏覽器 key（`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`）**：新建一把專用 key。
  - Application restriction → Websites：`http://localhost:3000/*`、`http://localhost:3001/*`（結尾一定要有 `*`，否則子頁面會 `RefererNotAllowedMapError`）。部署後再加正式網域。
  - API restriction → 只勾 Maps JavaScript API。
- [x] **伺服器 key（`GOOGLE_PLACES_API_KEY`）**：沿用原本的「Maps Platform API Key」。
  - API restriction → 從預設 32 APIs 縮到只剩 Places API (New)、Routes API（已對照程式碼：`src/` 與 `scripts/` 只打 `places.googleapis.com` 和 `routes.googleapis.com`）。
  - Application restriction 維持 None（伺服器請求沒有 referrer）；部署到固定出口 IP 的主機後改 IP restriction。
  - 之後要用新的 Google API：前端呼叫就加到瀏覽器 key，後端呼叫就加到伺服器 key，不要一次全開。
- [x] 刪除未使用的 OAuth Client ID「網路用戶端 1」（30 天內可還原）。
- [x] **OpenAI：**（2026-10-02）Project Settings → Limits 設 spend limit；Allow models 只開 `gpt-4o-mini`（程式碼所有呼叫都用 `OPENAI_MODEL ?? "gpt-4o-mini"`，`.env` 沒設 `OPENAI_MODEL`）。之後若改 `OPENAI_MODEL` 要先把新模型加進允許清單。
  - [ ] 確認 spend limit 是「擋請求」還是「只提醒」；若只提醒，Billing 的 Auto recharge 要關，預付額度才是硬上限。
- [ ] **金鑰輪替：** 如果任何 key 曾經出現在 commit、截圖、issue、聊天紀錄中，直接換掉。用 `git log -p -S "AIza"` / `git log -p -S "sk-"` 檢查歷史。

### Phase 1 — 成本濫用防護（程式層，部署前必做）

**1a. 輸入上限（最便宜的防線）** — 對應 R4、R5、R11
- [x] `FlightInfoSchema`：日期改成 `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` 並用 `.refine` 檢查：`returnDate > departureDate`、**天數 ≤ 30**（數字可討論）。（2026-09-29，`MAX_TRIP_DAYS` 在 `src/lib/inputLimits.ts`，前端表單同步擋。）「出發日不早於今天太多」沒做——過去日期不會讓單次請求變貴，不是成本問題。
- [x] 把 `prompt` 納入 zod schema（`GenerateRequestSchema`）：伺服器上限 1000 字、表單輸入框 500 字（表單會在後面接「中途停留城市：…」，所以伺服器留空間）。`generate-stream` 改用 `safeParse`，不合格回 400（原本 parse 失敗會變 500）。`TripPreferences.interests` 加 `.max(5)`。
- [x] 會進 prompt／Google 查詢的自由文字與陣列欄位加 `.max()`（2026-09-29）：`places/search`（query、cityHint、candidateCities ≤ 30）、`places/city-centers`（cityNames ≤ 30）、`stop-suggestions`（context、excludeNames）、`days/[dayId]/stops`（stopName、batch ≤ 50）、`transit-recommendations`（existingStops）。上限數字集中在 `src/lib/inputLimits.ts`。名稱清單上限放寬到 500，因為前端會送整趟行程的所有景點名。`interestBoost`/`avoid` 是 LLM 輸出、不是請求輸入，不需要。
- [x] 還沒有 schema 的路由改用 zod（2026-10-02）：`stops/[stopId]`（PATCH/DELETE）、`stops/reorder`、`stops/[stopId]/enrich`、`accommodation/enrich`。PATCH 會寫進行程 JSON、換地點時也寫進共用的 Place 快取，所以檢查型別與範圍（緯度 ±90、經度 ±180、評分 0–5、時長 0–1440 分、費用 ≥ 0）；數字欄位允許 `null`（前端清空輸入框會送 null）。壞掉的 JSON 改回 400（原本 500）。測試用前端實際送出的 payload 確認不會被擋。
- [x] `restructure` 限制每城天數 ≤ 14（跟前端一致）、全部城市加總 ≤ 30 天，前端超過時擋套用鈕並提示。
- [x] 所有 API 在 parse 前限制 body 大小：`src/proxy.ts`（Next 16 的 proxy）對 `/api/*` 的 POST/PUT/PATCH 檢查 `Content-Length`，> 256KB 回 413、沒帶回 411。

**1b. Rate limiting** — 對應 R3、R8
- [x] `src/lib/rateLimit.ts`（2026-10-02）：依 **IP + 費用等級** 做滑動視窗計數（sliding-window counter，每個 key O(1) 記憶體、沒有固定視窗邊界的 2 倍突發），被擋的請求不計入。在 `src/proxy.ts` 執行，路由跑之前就擋。
  - 目前是 in-memory（上限 10,000 個 key，LRU 淘汰），適合單機 / `next dev`。部署到 serverless / 多實例時，換成共用儲存（Upstash Redis 等），介面 `RateLimitStore` 不用改。
  - IP 取 `x-forwarded-for` 第一段 → `x-real-ip` → `"unknown"`。沒有可信任的 reverse proxy 時 `x-forwarded-for` 可偽造，靠下面的全域熔斷兜底。部署時確認平台會覆寫這個 header。
- [x] 分級套用（數字以「一個人正常使用 + 餘裕」為準；打開行程頁會一次對每個景點/每天各打一次 enrich，所以 Google 等級要容得下這種突發）：

  | 等級 | 路由 | 上限 |
  |---|---|---|
  | generate | `generate-stream` | 每 IP 每天 30 次（UTC 日界） |
  | ai | `*/regenerate`、`stop-suggestions`、`days/[dayId]/stops` POST、`restructure`、`transit-recommendations` | 每 IP 每小時 60 次 |
  | google | `places/search`、`places/city-centers`、`*/enrich`、`recalculate-transport`、`enrich-all-stops` | 每 IP 每分鐘 120 次 |
  | photo | `places/[id]/photo` | 每 IP 每分鐘 300 次 |
  | default | 其餘（純 DB） | 每 IP 每分鐘 300 次 |

- [x] 超限回 `429` + `Retry-After`（另附 `X-RateLimit-Limit` / `X-RateLimit-Remaining`）。前端 `useStreamingGenerate` 對 429 顯示中文訊息。
- [x] **全域熔斷**：`src/lib/dailyBudget.ts`，在 `googleFetch.ts` 與 OpenAI client 的自訂 `fetch`（`openai.ts`）計「今日（UTC）全站呼叫次數」，Google 3,000 次、OpenAI 1,000 次，超過回假的 429（帶 `x-should-retry: false`，OpenAI SDK 不會重試；呼叫端本來就把非 OK 當暫時失敗、不寫快取）。in-memory，重啟歸零 —— GCP 每日配額與 OpenAI spend limit 是外層上限。`scripts/*` 用自己的 fetch，不受此限。
- [x] `generate-stream` **同時執行數限制**：同一 IP 同時只能 1 條串流，串流結束（不論成功、失敗、例外）在 `finally` 釋放。
- 驗證：單元測試（分級對照、滑動視窗、Retry-After、LRU、熔斷、併發閘）；`dev:mock` 實測同一 server 的計數器跨請求保留，`generate-stream` 送無效 body（400、不呼叫 OpenAI）第 31 次回 429。
- 已知限制：無效請求也會吃 generate 次數；`Retry-After` 以 UTC 日界計算（台灣早上 8 點重置）。

**1c. 修照片路由** — 對應 R6、R7
- [x] `name` 參數用白名單 regex 驗證，只接受 `^places/[A-Za-z0-9_-]+/photos/[A-Za-z0-9_-]+$`，不符合回 400。
- [x] 或更嚴格：只接受 DB 內已存在的 `photoName`，或 name 的 `places/<id>` 前綴必須等於路徑上的 `placeId`。
- [x] `photoUriCache` 改成有上限的 LRU（例如 2000 筆）。
- [ ] API key 改放 header（`X-Goog-Api-Key`）而不是 query string，避免出現在任何 log。

### Phase 2 — 存取控制（對外開放給他人使用前必做）

對應 R1、R2。

- [ ] **決定模式**（二選一）：
  - **A. 個人 demo 模式**（最簡單）：整站加一層密碼 / Basic Auth（`middleware`/`proxy` 檢查一個 env 裡的密碼或 cookie），只有知道密碼的人能用。適合作品集展示：給面試官一組密碼即可。
  - **B. 真正多使用者**：導入 Auth.js（NextAuth）或 Clerk，用 OAuth 登入；`User` 表已存在，把 `DEMO_USER_ID` 換成 session user id。
- [ ] 若選 B：**每一支** 讀寫 itinerary / day / stop / trash / candidate log 的路由，都要驗證 `itinerary.userId === session.userId`。建議抽一個 `requireOwnedItinerary(id, userId)` helper，所有路由共用，避免漏掉。
- [ ] `/itineraries` 列表只查自己的行程（`where: { userId }`）。
- [ ] 加整合測試：用 A 使用者的 session 去存取 B 的行程，預期 404（不要回 403，避免透露 id 存在）。
- [ ] 有 cookie session 之後，確認寫入 API 都是 POST/PATCH/DELETE 且檢查 `Origin` header（CSRF 防護；Next.js Server Actions 已內建，但 Route Handlers 沒有）。

### Phase 3 — AI 特有風險

對應 R5。

- [x] **提示注入緩解**（2026-10-02）：`src/lib/untrustedInput.ts` —— 使用者可控制的文字用 `<user_input>` 標記包起來放在 **user message**，system prompt 附加 `UNTRUSTED_INPUT_RULE`（標記內只是資料、不是指令；要求改規則、改格式、透露系統說明一律不理）。包裝時會移除輸入裡任何開／關 `user_input` 標記的字串，避免提早結束資料區塊。
  - 套用處：風格描述 —— `tripPlan.ts`（**原本直接放在 system prompt**，影響最大）、`generate-stream` 舊流程、`preferenceIntent.ts`；新增景點時輸入的名稱（`days/[dayId]/stops`，原本也在 system prompt）；`stop-suggestions` 的 `context` 與 `excludeNames`（`excludeNames` 原本在 system prompt）。
  - 不需要處理：`transit-recommendations` 的 `existingStops` 只用來過濾結果、不進 prompt；Google 回來的地點名稱不是使用者輸入。
  - 殘餘風險：`restructure` 的城市名、必去景點名會進 `itineraryCityGen` 的 prompt（每個最多 200 字，前端來源是 Google 搜尋結果），先不處理。
  - 實際影響有限的原因：網站沒有多使用者，prompt 裡沒有別人的資料；輸出一律經過 zod 驗證、以純文字渲染（沒有 `dangerouslySetInnerHTML`）；輸入長度有上限（1a）、次數有上限（1b）。標記包裝只是降低模型被帶偏的機率，無法保證。
  - 驗證：單元測試確認風格描述不再出現在 system prompt、標記無法被提早關閉。另外用 `dev:mock`（Google 假、OpenAI 真）實際生成一次帶風格描述的行程，確認描述移到 user message 後仍被採用。
- [x] 設定 `max_tokens`：**決定不另外加**。模型已限定只能用 `gpt-4o-mini`（Phase 0），它本身的輸出上限是 16,384 tokens，單次呼叫的輸出成本最多約 US$0.01；真正的成本槓桿是輸入長度（1a）和呼叫次數（1b、全站每日上限），都已處理。另外設太小的上限會讓長行程的 JSON 被截斷、生成失敗。`generate-stream` 舊流程原本就有 `max_tokens: 16000`。
- [x] 輸出一律走 zod 驗證、不當 HTML 渲染（既有，已確認）。
- [ ] 可選：OpenAI Moderation API。**暫不做**：只有自己使用、內容只出現在自己的行程裡，多一次呼叫的延遲不划算。開放給其他人使用時再評估。
- [x] 不把 system prompt、內部錯誤、其他使用者的資料放進回應串流（內部錯誤已在 Phase 4 改成 `requestId`；system prompt 本身不含機密）。

### Phase 4 — Web 基本防護

對應 R9、R10。

- [x] `next.config.ts` 加 `headers()`（2026-10-02，內容在 `src/lib/securityHeaders.ts`，有單元測試）：
  - `Content-Security-Policy`：**目前是 `Content-Security-Policy-Report-Only`**，違規只會出現在瀏覽器 Console、不會擋東西。允許清單照 Google 官方的 Maps JS CSP 指南（`*.googleapis.com`、`*.gstatic.com`、`*.google.com`、`*.ggpht.com`、`*.googleusercontent.com`，照片轉址也落在這裡），加上 `frame-ancestors 'none'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`。dev 額外允許 `ws:`（HMR）。
    - Next.js 的 inline script 沒設 nonce，所以 `script-src` 有 `'unsafe-inline'`；Maps JS 需要 `'unsafe-eval'`。之後要更嚴可以改用 nonce（Next 支援在 proxy 產生）。
    - [ ] 正常使用一段時間、Console 沒有 CSP 違規後，設 `CSP_ENFORCE=1` 改成強制執行。
  - `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`（相機、麥克風、定位、付款、USB 全關，程式碼都沒用到）。
  - `Strict-Transport-Security`：只在 production 加（http://localhost 不需要）。
  - `poweredByHeader: false`：不再回 `X-Powered-By: Next.js`。
  - 驗證：`dev:mock` 實測首頁和 API 回應都帶上述標頭。
- [x] 錯誤處理（2026-10-02）：`src/lib/apiError.ts` 的 `internalErrorResponse()`，15 支路由的 catch 改用它 —— 完整錯誤只寫進伺服器 log，回給前端的只有通用訊息 + 8 碼 `requestId`（同一個 id 也印在 log 那一行，可對照）。`generate-stream` 串流裡的兩處 `error.message` 也改成 `requestId`，前端顯示「（錯誤代碼 xxxx）」。保留的：zod 的 `error.flatten()`（只描述呼叫端自己送的欄位）、`generate-stream` 的行程驗證代碼（描述 AI 產出的行程哪裡不合格，不含內部資訊）。
- [x] API 路由不需要被跨站呼叫 → 不設定 CORS（預設就是同源），確認之後也不要加 `Access-Control-Allow-Origin: *`。（2026-10-02 確認程式碼沒有任何 `Access-Control-Allow-Origin`。）

### Phase 5 — 監控、依賴與流程

- [ ] **記錄**：每次 OpenAI / Google 呼叫記下 時間、路由、IP（或 user）、估算成本；可以直接擴充 `googleFetch.ts`。這樣被濫用時能看出是誰、從哪個路由。
- [ ] **告警**：當日成本估算超過門檻時通知（email / Discord webhook）。
- [x] **依賴安全**（2026-10-02）：
  - `npm audit` 原本 11 個漏洞（1 critical、7 high），critical 在 Next.js 本身（含「Windows 上的 server 可被未驗證遠端執行程式碼」—— 開發機就是 Windows，`next dev` 也會開在區網）。`next`、`eslint-config-next` 16.1.6 → 16.3.8（同一個 major），其餘用 `npm audit fix` 在原版本範圍內修掉 → **0 個**。升級後單元／整合測試、`tsc`、lint、`npm run build` 全過，`dev:mock` 實測頁面、安全標頭、rate limit 正常。
  - 新增 `.github/dependabot.yml`：npm 每週一次（minor/patch 合成一個 PR）、GitHub Actions 每月一次。
  - [ ] GitHub repo **Settings → Code security** 開啟 Dependabot alerts 與 Dependabot security updates（要在網頁上開）。
  - Next.js 有過多次 middleware 繞過類漏洞，**保持 `next` 在最新 patch 版本**，且不要只靠 middleware（`proxy.ts`）做授權（Phase 2 做登入時，路由內也要檢查）。
  - 附帶：Next 16.3 的 `next dev` 會在 repo 根目錄自動產生 `AGENTS.md`／`CLAUDE.md`，已在 `next.config.ts` 設 `agentRules: false` 關掉。
- [x] **CodeQL**（2026-10-03）：GitHub Code scanning → CodeQL Default setup；Copilot Autofix 維持開啟（只給建議、不會自動改程式碼），AI Scan for PRs 維持關閉（給 CodeQL 不支援的語言用）。
- [x] **`main` 分支保護**（2026-10-03，ruleset）：禁止刪除與 force push、必須透過 PR、CI（`ci`）通過才能合併；核准數 0（一個人無法核准自己的 PR）；合併方式只留 Merge。
- [x] **Dependabot 第一批 PR**（2026-10-03）：合併 minor/patch 群組與 `actions/checkout`、`actions/setup-node` 4→7；prisma 5→7、typescript 5.9→7、vitest 4→5 用 `@dependabot ignore this major version` 略過（都需要專門遷移）。
  - [ ] openai 6→7（#47）：CI 通過但測試全是 mock；要實際呼叫一次 API，確認 `openai.ts` 自訂 `fetch` + `x-should-retry` 的全站每日上限還有效再合併。
  - 已知：`braces` 的 high 漏洞（2026-10-03 公布）只在 lint 工具的依賴裡，`--omit=dev` 為 0，CI 通過；npm 建議的修法是把 `eslint-config-next` 降到 14 版，不採用，等上游修正。
- [ ] **祕密掃描**：GitHub **Settings → Code security** 開啟 Secret scanning + Push protection（公開 repo 免費，要在網頁上開）。本地 `gitleaks` pre-commit hook 先不加。
- [x] **CI**：`.github/workflows/ci.yml` 其實 2026-09-13 就有了（lint、單元測試、整合測試、build）；2026-10-02 加上 `npm audit --omit=dev --audit-level=high`，會出貨的依賴有 high 以上漏洞就讓 CI 失敗；只用在開發的工具交給 Dependabot。
- [x] **資料庫**：SQLite 在 `prisma/`，不在 `public/`（已確認），也不會被靜態服務；`dev.db`、`mock.db`、`test.db` 都在 `.gitignore`。部署時的備份等 Phase 2／部署時再處理。
---

## 3. 建議執行順序

| 順序 | 項目 | 理由 | 預估工作量 |
|---|---|---|---|
| 1 | Phase 0 全部 | 不寫程式、立刻封頂最壞情況的帳單 | 30 分鐘 |
| 2 | 1a 輸入上限 + 1c 照片路由 | 小改動、風險最高的洞 | 半天 |
| 3 | 1b rate limit + 全域熔斷 | 公開部署的前提 | 1 天 |
| 4 | Phase 2（先做 A：密碼保護） | 擋住陌生人刪改資料 | 半天（A）/ 2–3 天（B） |
| 5 | Phase 4 安全標頭 + 錯誤訊息 | 常見檢查項，面試常被問 | 半天 |
| 6 | Phase 3 AI 風險 | 降低提示注入影響 | 半天 |
| 7 | Phase 5 監控與 CI | 長期維運 | 持續 |

每個 Phase 建議開獨立 branch（例如 `security/input-limits`、`security/rate-limit`、`security/photo-route`），一個 PR 做一件事。

---

## 4. 驗證方式（只在本機測）

> 依 `CLAUDE.local.md` 規則：**只對 localhost / 本機 DB / mock 服務測試**，不對任何外部系統做掃描或攻擊測試。

- 單元測試（免費）：
  - schema：超過 30 天、超長 prompt、錯誤日期格式 → 應被拒絕。
  - 照片路由：`name=../../foo`、`name=places/x/photos/y?key=z` → 400。
  - rateLimit：第 N+1 次回 429。
- 整合測試（`npm run test:integration`，`MOCK_AI=1`）：跨使用者存取 → 404。
- 手動：`npm run dev:mock`（Google 全假）搭配 curl 迴圈打 `places/search` 驗證 429。**注意 `dev:mock` 的 OpenAI 仍是真的**，測 `generate-stream` 限流時要先確認或改用 mock。
- 安全標頭：用瀏覽器 DevTools → Network 看 response headers；部署後可用 securityheaders.com 檢查自己的網域。

---

## 5. 待決定事項

- [ ] 部署目標是哪裡？（Vercel serverless vs. 單台 VM）→ 決定 rate limit 要用 in-memory 還是 Redis。
- [ ] Phase 2 選 A（密碼保護的 demo）還是 B（真正登入）？
- [ ] 天數上限、每日生成次數上限的具體數字。
- [ ] 是否要讓未登入訪客看到「唯讀的範例行程」（作品集展示用），其餘功能需登入。
