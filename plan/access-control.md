# 存取控制與使用額度規劃（security-hardening Phase 2）

> 狀態：規劃中（2026-10-03 建立）
> 前置關係：`plan/docker-and-ci.md` 的「自動部署」要等這份做完。這份是 `plan/security-hardening.md` Phase 2 的詳細版。

---

## 0. 已決定的產品方向

- **訪客不用登入就能生成 1 個行程**，看到成果後，想**下載 PDF** 才需要註冊登入。
- **登入只用 Google**（Auth.js）。Email 驗證連結需要另外接寄信服務，先不做。
- **訪客的行程保留 3 天**，沒有註冊就自動刪除；**註冊後，訪客期間做的行程自動轉到新帳號**。
- **只限制「會花錢」的編輯**；只寫 DB 的編輯不限制。
- 開放註冊，所以**每個帳號都要有每日額度**，而且要處理「多開帳號繞過額度」。
- **PDF 用瀏覽器列印**產生（2026-10-03 決定）。
- **做公開唯讀範例**：挑幾個行程不用登入就能看，給面試官直接打開（2026-10-03 決定）。

---

## 1. 現況（2026-10-03 看過程式碼）

- 沒有任何登入。`generate-stream` 把所有行程寫給寫死的 `DEMO_USER_ID`；`/itineraries` 列出全部行程。
- 資料結構已經有一半：`User`（`email` 必填且 unique）、`Itinerary.userId`，垃圾桶（`DeletedStop`/`DeletedDay`）與候選紀錄（`*CandidateLog`）都掛在 itinerary 底下（`onDelete: Cascade`）。
- 30 支 API 路由中，**26 支會讀寫某個行程，全都沒有檢查擁有者**（IDOR：知道 id 就能看、改、刪）。不少路由是用 URL 的 `dayId`／`stopId` 加 body 的 `itineraryId` 找資料。
- 共用快取（`Place`、`PlaceQuery`、各種 `*Cache`）不屬於任何人，維持全站共用（反而省錢），不在這次範圍。
- Phase 1 的 rate limit 存在記憶體裡，server 重開就歸零——適合擋突發流量，**不適合當「每天幾次」的額度**。

---

## 2. 使用者分級與額度（起始值，之後依實際用量調整）

| | 訪客（沒登入） | 註冊使用者 | 管理者（`ADMIN_EMAILS`） |
|---|---|---|---|
| 生成行程 | 1 次（每個訪客身分） | 每天 5 次；**註冊後前 3 天每天 2 次** | 不限 |
| 會花錢的編輯 | 每個行程 5 次 | 每天 30 次 | 不限 |
| 免費的編輯 | 不限 | 不限 | 不限 |
| 下載 PDF | ❌（按下去引導登入） | ✅ | ✅ |
| 行程保留 | 3 天 | 永久 | 永久 |

**會花錢的編輯**（會呼叫 OpenAI 或 Google，計入額度）：
`accommodation/regenerate`、`meals/[mealType]/regenerate`、`stop-suggestions`、`days/[dayId]/stops` POST（新增景點會呼叫 AI 寫描述、Google 查地點）、`restructure`、`transit-recommendations`。

**不計入額度**：
- 只寫 DB：`select`（選候選）、`stops/[stopId]` PATCH/DELETE、`stops/reorder`、`remove-waypoint`、垃圾桶相關、`itinerary/[id]` DELETE。
- 頁面打開時自動補資料的 enrich（`enrich-all-stops`、`stops/[stopId]/enrich`、`accommodation/enrich`、`recalculate-transport`）：使用者沒有主動操作，計入額度會讓人莫名其妙被擋。它們已經有快取 + 失敗紀錄（`enrichFailure`）避免重複計費，另外受 Phase 1 的 rate limit 與全站每日上限保護。

---

## 3. 多開帳號的對策

做不到 100% 防止。目標是**讓多開不划算**，而且**被繞過時每天的損失仍有上限**。

| 層 | 做法 | 擋住什麼 |
|---|---|---|
| 1. **全站每日總上限**（最重要） | 上線初期註冊使用者合計每天最多生成 15 次、訪客合計 5 次（依 PR 0 量測，見下方）；超過時對新請求回「今日名額已滿」 | 不管開多少帳號，最壞情況每天的花費可以算出來 |
| 2. 同 IP 共用額度 | 同一個 IP 不分帳號，每天合計最多生成 10 次（訪客 2 次） | 同一台電腦／同一個網路切換帳號 |
| 3. 同裝置共用額度 | 長期的 `device_id` cookie（httpOnly、簽章），同一台裝置上所有帳號共用額度 | 同一個瀏覽器登出再登入別的帳號 |
| 4. 新帳號額度較低 | 註冊後前 3 天每天只能生成 2 次 | 新開的帳號立刻拿滿額度 |
| 5. CAPTCHA | Cloudflare Turnstile（免費，多數人不用手動點），**每次生成前**伺服器端驗證 token | 腳本自動化大量生成 |
| 6. 只用 Google 登入 | 開新的 Google 帳號通常需要手機驗證 | 免費大量開帳號 |
| 7. 停用帳號 | `User.disabledAt`，被停用的帳號所有付費操作直接拒絕 | 事後處理已發現的濫用 |

再外層還有已經設好的 **GCP 每日配額、OpenAI spend limit、全站每日呼叫上限（`dailyBudget.ts`）**。

**量測結果（2026-10-03，PR 0，`dev:mock`：Google 假、OpenAI 真）**

行程：首爾進、釜山出、6 天（多城市、含移動日），走規則引擎路徑成功。

| | 快取沒命中（第 1 次） | 快取命中（同行程第 2 次） |
|---|---|---|
| Text Search（Pro 欄位） | 2 | 0 |
| Nearby Search（**欄位含 `rating`／`priceLevel` → Enterprise 計費**） | 12 | 0 |
| Compute Route Matrix（Essentials） | 14 | 1 |
| OpenAI（gpt-4o-mini） | 10 次，輸入 7.6k + 輸出 3.3k tokens | 10 次，幾乎相同 |

換算成本（Google／OpenAI 公告單價，超過每月免費額度後；以官方價目表為準）：
- OpenAI：約 **US$0.003／次生成**，幾乎可以忽略。
- Google，快取沒命中：Nearby Enterprise 12 × $35/千 ≈ $0.42、Route Matrix 14 × $5/千 ≈ $0.07、Text Search Pro 2 × $32/千 ≈ $0.06 → 約 **US$0.55／次**。
- Google，快取命中：約 US$0.005／次。
- **免費額度內都是 0**。最先用完的是 **Nearby Search Enterprise 每月 1,000 次**：每次沒命中快取的生成用 12 次 → 每月約 **80 次**沒命中快取的生成是免費的。

結論：
- 成本幾乎都在 Google，而且取決於快取有沒有命中。同一個城市第二次以後的生成很便宜；**刻意挑不同城市的濫用者**才會一直打到最貴的情況（不過 IATA 機場代碼與城市數量有限，快取會逐漸被填滿）。
- 原本規劃的全站每日上限（註冊 200 + 訪客 50）如果全部都沒命中快取，最壞約 US$137／天，**遠超過目前的預算**（NT$500／月）。上線初期建議從**每天合計 20 次**（訪客 5 + 註冊 15）開始，看實際快取命中率再放寬；GCP 每日配額仍是最外層的硬上限。
- 下一個省錢的槓桿：Nearby Search 的欄位含 `rating`／`priceLevel`（Enterprise，每月免費 1,000 次）。改成 Pro（每月免費 5,000 次）會讓免費額度變 5 倍，但餐廳／住宿的評分排序與價位估算會受影響——跟 9 月 Text Search 的取捨同一類，另開議題評估。
- 沒量到的：打開行程頁時的自動 enrich（規則引擎產生的景點已經帶 placeId，預期很少）、規則引擎失敗改走舊流程時的額外呼叫，以及會花錢的編輯（換一個、重新產生）——PR 4 做額度時用同一個 `runMetered` 補量。
---

## 4. 資料結構變更

```prisma
model User {
  id          String    @id @default(uuid())
  email       String?   @unique        // 訪客沒有 email（原本必填）
  name        String?
  isGuest     Boolean   @default(false)
  disabledAt  DateTime?                // 停用帳號
  createdAt   DateTime  @default(now())  // 也用來判斷「新帳號」
  ...
}

model Itinerary {
  ...
  expiresAt   DateTime?                // 訪客行程：建立時 + 3 天；轉到註冊帳號時清成 null
  isPublic    Boolean   @default(false) // 公開唯讀範例（作品集展示用，見 §8）
}

// 額度要能撐過 server 重開，所以記在 DB，不放記憶體
model UsageEvent {
  id         String   @id @default(uuid())
  kind       String   // "generate" | "paid_edit"
  userId     String?  // 訪客也有 User 列，所以通常有值
  ipHash     String   // HMAC(IP, USAGE_HASH_SECRET)，不存原始 IP
  deviceId   String?
  itineraryId String?
  createdAt  DateTime @default(now())

  @@index([kind, createdAt])
  @@index([userId, kind, createdAt])
  @@index([ipHash, kind, createdAt])
  @@index([deviceId, kind, createdAt])
}
```

- **IP 只存雜湊**（加密鑰的 HMAC），一樣能比對「同一個 IP」，但資料庫外洩時不會洩漏使用者 IP。`UsageEvent` 只保留 30 天。
- Auth.js 用 **JWT session**，不需要 `Account`／`Session`／`VerificationToken` 資料表 → **跟 `plan/docker-and-ci.md` 的 SQLite → PostgreSQL 遷移互不影響**，順序可以自由安排。
  - 如果先做 Postgres（改用 migrations），這裡的變更就是一個正式 migration；如果先做這份，Postgres 的 `init` migration 會一起包進去。兩種都可以。

---

## 5. 身分怎麼判斷（每個請求）

`src/lib/auth/currentActor.ts` 的 `getActor(request)` 回傳：
- 有 Auth.js session → 註冊使用者（`ADMIN_EMAILS` 裡的 email 標成管理者）。
- 沒有 session、但有簽章過的 `guest_id` cookie → 訪客（對應一筆 `isGuest` 的 User）。
- 都沒有 → 「還沒有身分」：只有生成行程會**建立**訪客身分並設 cookie；其他寫入 API 直接 401。

**登入時轉移訪客行程**：Google 登入成功的 callback 裡，如果帶著 `guest_id` cookie，就把那個訪客的行程 `userId` 改成新帳號、`expiresAt` 清成 null，刪掉訪客 User，清掉 cookie。

**不能只靠 `proxy.ts` 檢查**（Next.js 有過多次 middleware 繞過漏洞）：proxy 可以先擋明顯沒身分的請求，但**每支路由裡一定要再檢查一次**。

---

## 6. 擁有權檢查

`requireOwnedItinerary(actor, itineraryId)`：找不到、不是自己的、已過期（`expiresAt < now`）→ 一律回 **404**（不回 403，不透露這個 id 存在）。公開範例在**讀取**時放行，**寫入**一律擋。

要套用的路由（26 支）：
- **行程本身**：`itinerary/[id]`（GET／DELETE）、`enrich-all-stops`、`remove-waypoint`、`restructure`、`transit-recommendations`
- **垃圾桶**：`itinerary/[id]/trash`、`trash/[deletedStopId]`、`trash/[deletedStopId]/restore`、`trash/days`、`trash/days/[deletedDayId]`、`trash/days/[deletedDayId]/restore`
- **用 dayId + body 的 itineraryId**：`days/[dayId]/accommodation/{candidates-history,enrich,regenerate,select}`、`days/[dayId]/meals/[mealType]/{candidates-history,regenerate,select}`、`recalculate-transport`、`stop-suggestions`、`days/[dayId]/stops`、`days/[dayId]/stops/[stopId]/candidates-history`
- **用 stopId + body 的 itineraryId**：`stops/[stopId]`（PATCH／DELETE）、`stops/[stopId]/enrich`、`stops/reorder`
- **頁面**：`/itineraries` 只列自己的；`/view/[id]`、`/view/[id]/trash` 用同一個檢查（server component 裡做）

不用改：`exchange-rate`、`places/search`、`places/city-centers`、`places/[placeId]/photo`（不碰任何人的行程；已有 rate limit）。

---

## 7. 訪客行程的生命週期

- 生成時 `expiresAt = now + 3 天`；頁面上顯示「這個行程會在 X 天後刪除，登入即可永久保存並下載 PDF」。
- 過期的行程讀取時當作不存在（404），所以就算還沒清掉也看不到。
- 清理：`scripts/cleanup-expired-guests.ts`（刪除過期行程與沒有行程的訪客 User，Cascade 會一起刪掉垃圾桶與候選紀錄）。部署後用排程每天跑一次；在那之前手動跑。

---

## 8. PDF 下載與公開範例

### PDF：瀏覽器列印（已決定）

- 下載按鈕呼叫 `window.print()`，搭配列印專用 CSS（`@media print`）：隱藏導覽列、按鈕、地圖、編輯控制項，每天一個區塊、避免在景點中間換頁（`break-inside: avoid`），使用者在列印對話框選「另存為 PDF」。
- 優點：不用新增套件、**中文字型天生正常**、Docker image 不變大、不花伺服器資源。
- 代價：「要登入才能下載」只做在畫面上（訪客按下去顯示「登入後即可下載 PDF」），擋不住使用者自己按 Ctrl+P。這可以接受——內容本來就在畫面上看得到，這個限制的目的是**引導註冊**，不是保護資料。
- 為了讓「下載」比 Ctrl+P 好用：列印前可以展開所有收合的區塊、加上行程標題與日期的頁首；訪客直接 Ctrl+P 印出來的是一般網頁版面。
- 列印版也會帶照片：照片走 `/api/v1/places/[placeId]/photo`，已受 rate limit 與快取保護；地圖不列印（Google Maps 列印效果差，也會多一次地圖載入）。
- 不呼叫 OpenAI／Google，不計入額度。

### 公開唯讀範例（已決定要做）

- `Itinerary.isPublic`：只有管理者能切換（行程頁上一個開關，或先用 script 設定）。
- 公開行程：**不用登入就能看** `/view/[id]`，畫面上隱藏所有編輯控制項；**所有寫入 API 一律擋**（`requireOwnedItinerary` 對非擁有者只放行讀取）。擁有者自己打開時照常可以編輯。
- 首頁或 README 放幾個範例連結，給面試官直接打開。
- 公開行程裡**不能有個人資料**：行程本身只有地點與時間，但 `generatedWith`（使用者輸入的風格描述）會存進 config，公開前要確認內容可以給別人看，或公開頁面不顯示它。
- 公開頁面打開時，前端的自動 enrich（`enrich-all-stops` 等）**不能**被訪客觸發去寫入別人的行程：公開範例只顯示已經補好資料的內容，非擁有者不呼叫 enrich。

## 9. 分成幾個 PR

| # | 分支 | 內容 | 驗收 |
|---|---|---|---|
| 0 | `chore/usage-metrics` | `src/lib/usageMeter.ts`：`googleFetch` 與 OpenAI fetch 計數，`generate-stream` 每次生成印一行 `[usage]`；`dev:mock` 量測 | ✅ 2026-10-03 完成，結果見 §3 |
| 1 | `feat/auth-google` | Auth.js v5（`next-auth@5.0.0-beta.32`）+ Google、JWT session、`getActor()`、`ADMIN_EMAILS`、頁面頂端登入／登出列；`generate-stream` 把行程存給已登入的人（沒登入暫時仍存給 demo user，PR 3 換成訪客）；`npm run claim-demo-itineraries` 把 demo user 的行程轉給管理者；CSP `form-action` 允許 `accounts.google.com` | 能登入登出；既有行程出現在自己帳號下。部署時要另外設 `AUTH_TRUST_HOST=true`（非 Vercel 的主機）與正式網域的 OAuth 重新導向 URI |
| 2 | `security/itinerary-ownership` | ✅ `src/lib/auth/ownership.ts` 的 `authorizeItinerary()` 套到 26 支路由（檢查在任何寫入、OpenAI、Google 呼叫之前，也在 `MOCK_AI` 分支之前；垃圾桶路由先檢查擁有權再查垃圾桶項目）；`/itineraries` 只列自己的、沒登入顯示提示；行程頁區分 401／404 訊息；**生成暫時需要登入**（PR 3 之前，避免沒登入的人生成後打不開）；測試用 `tests/setup/mockAuth.ts` 的 `signInAs()` | `ownership.integration.test.ts`：A 對 B 的行程 10 種操作全部 404 且資料不變、B 正常、沒登入 401；`dev:mock` 實測沒登入時讀／刪／生成都 401 且沒有任何付費呼叫 |
| 3 | `feat/guest-itineraries` | ✅ schema：`User.email` 可為 null、`User.isGuest`、`Itinerary.expiresAt`；`src/lib/auth/guest.ts`（`guest_id` cookie = `userId.HMAC(AUTH_SECRET)`，httpOnly、SameSite=Lax、3 天）；`getActor()` 回傳 user 或 guest；沒登入生成 → 建立訪客（在併發閘之後，被擋的請求不會留下訪客列）、行程 `expiresAt` = 3 天、回應帶 Set-Cookie；Google 登入的 `jwt` callback 把訪客行程轉到帳號、清掉 `expiresAt`、刪訪客列與 cookie；過期行程讀取與列表都當不存在；行程頁訪客提示 + 登入按鈕；`npm run cleanup-expired-guests` | `guest.test.ts`（簽章、竄改、換 secret）；`guest.integration.test.ts`（訪客能開自己的、別的訪客 404、偽造 cookie 401、過期 404、登入轉移後帳號能開、舊 cookie 失效） |
| 4 | `feat/usage-quotas` | ✅ `UsageEvent` 表、`User.disabledAt`；`src/lib/quota.ts`（`evaluateQuota` 純函式 + DB 計數，24 小時滾動視窗）；`proxy.ts` 發 `device_id` cookie（httpOnly、一年，當次請求就讀得到）；生成在建立訪客**之前**檢查、通過就先記錄（花費與成敗無關）；6 支付費編輯路由用 `chargePaidEdit()`（`transit-recommendations` 只在快取沒命中時計入、新增景點只算輸入名稱那條路徑）；管理者不計入也不受限；前端顯示伺服器回傳的中文原因；清理腳本刪除 30 天前的使用紀錄。與原計畫的差異：IP 雜湊用 `AUTH_SECRET` 加上用途前綴，不另外新增 `USAGE_HASH_SECRET`；付費編輯多加「每個 IP 每天 60 次」 | `quota.test.ts`（每一層各自觸發）；`quota.integration.test.ts`（24h 視窗、同 IP／同裝置跨帳號共用、訪客 1 次 + 全站訪客上限、管理者不受限、停用帳號、透過真實路由用 MOCK_AI 測付費編輯 429 且被擋的不記錄）；`dev:mock` 實測 device cookie 與「用完額度的訪客在任何付費呼叫前被擋」 |
| 5 | `feat/turnstile` | ✅ `src/lib/turnstile.ts`（siteverify，連不上 Cloudflare 時一律拒絕；沒設 secret 時開發環境略過、正式環境拒絕）；`generate-stream` 在額度檢查與建立訪客**之前**驗證、管理者略過、失敗回 403 並釋放同時生成的鎖；首頁 `TurnstileWidget`（explicit render，表單在生成期間卸載、出錯後重新掛載，自然拿到新的一次性 token），沒拿到 token 前生成鈕停用；CSP 加入 `challenges.cloudflare.com` | `turnstile.test.ts`（通過、被拒、缺 token、Cloudflare 連不上、開發／正式環境沒設 secret）；`turnstile.integration.test.ts`（真實生成 API：沒 token 或被拒 → 403，沒有建立訪客、沒有記錄使用量、沒有呼叫 OpenAI；鎖有釋放） |
| 6 | `feat/itinerary-print` | 列印專用 CSS、下載按鈕（訪客顯示引導登入） | 登入者按下載出現列印對話框、版面正常（中文、每天一區塊、不印地圖與按鈕）；訪客看到引導登入 |
| 7 | `feat/public-examples` | `isPublic`、管理者切換、公開頁唯讀（隱藏編輯控制項、不觸發 enrich）、範例連結 | 未登入能看公開行程；對公開行程呼叫任何寫入 API 都被擋；非公開行程未登入 404 |

預估 4～5 天（PDF 改用瀏覽器列印省下約半天，公開範例多約半天）。**PR 1、2 合併後，「任何人都能刪改別人的行程」就解決了**，之後的 PR 是產品功能與額度。

**需要新增的環境變數**：`AUTH_SECRET`（也用來簽訪客 cookie、雜湊 IP）、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`ADMIN_EMAILS`、`TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`（`.env.local.example` 要同步更新；`.env*` 都在 `.gitignore`）。

**需要你在外部建立的**：Google Cloud OAuth client（授權的重新導向 URI 先填 `http://localhost:3000/api/auth/callback/google`）、Cloudflare Turnstile site。

---

## 10. 還沒決定

- [x] PDF 用瀏覽器列印（2026-10-03）。
- [x] 做公開唯讀範例（2026-10-03）。
- [x] 全站每日上限：上線初期**每天合計 20 次**（訪客 5 + 註冊 15），2026-10-03 決定；看實際快取命中率再放寬。
- [ ] Nearby Search 要不要也降到 Pro 欄位（免費額度 ×5，但影響評分排序與價位估算）。
- [ ] 部署後清理 script 用什麼排程跑（看 `plan/docker-and-ci.md` 最後選的部署方式）。
