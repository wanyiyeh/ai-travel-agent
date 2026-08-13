# 行程生成流程設計說明

> 建立日期：2026-07-11

---

## 核心邏輯：Google → AI → Google 三段式

不管是種子腳本還是正式 app，生成一筆行程都遵循同一個順序，且**不可逆**：

```
Google Places（先圈候選池，只給名稱+評分）
        ↓
AI 生成（決定用哪些名稱、怎麼分天分餐、順序）
        ↓
Google Places（用 AI 寫出的名稱反查真實座標）
```

原因是兩次 Google 呼叫解決的是不同問題，且有嚴格的先後依賴：

- **第一次（Nearby Search）**：用「類型＋城市座標範圍」查，不需要知道任何名稱。目的只是給 AI
  一份「這城市附近真的有哪些店/景點」的參考清單，讓 AI 不要憑空編造不存在的地點。
  field mask 故意只要 `displayName`、`rating`（見 `src/lib/fetchCityRestaurants.ts`
  的 `searchNearbyHints`），不查座標／placeId——因為這批候選（每類型 15~20 筆）大部分
  不會被 AI 選中，先幫全部候選查座標是浪費 API 額度。
- **第二次（Text Search）**：用「名稱字串」反查座標，必須先有確定的名稱才能查。AI 除了會
  從候選清單挑，prompt 也明確允許在清單不足時補充清單外的真實地點——也就是說，在 AI
  生成完成之前，連「最終會出現哪些地點名稱」都不確定，自然無法提前查座標。

一句話：**第一步查的是「附近有什麼」（不需要名字），第三步查的是「這個名字在哪」（必須先有名字）**。
AI 生成正是產生「名字」的環節，所以座標補齊天生只能排在 AI 生成之後。

---

## 流程一：種子腳本（`scripts/seed-test-data.ts`，同步整批跑完）

給 batch script 用，不在意使用者等待體驗，四階段同步依序執行：

1. **Google Places 抓餐廳提示**（第337-360行）
   對抵達城市、回程城市平行呼叫 `fetchCityBreakfastPlaces`、`fetchCityRestaurants`
   （依 budget 篩類型/價位），組成 `restaurantHintsPrompt` 塞進 system prompt。
2. **AI 同步生成整份行程**（第369-434行）
   `openai.chat.completions.create`（非串流，一次等完整 JSON）。之後跑
   `tagWaypointCities` / `repairTransitDayDepartureCities` / `repairMissingAccommodation`，
   再用 `validateItinerary` 驗證；命中特定錯誤代碼（天數不符、transit day 缺失等）才整個重試
   （最多 3 次），一般警告不觸發重試。
3. **Google Places 補真實座標**（第542-602行）
   逐天逐個 stop/meal：過濾交通接駁類假 stop → 先查本地 `placeCache`
   （`lookupByQuery`）→ 沒快取才打 `searchPlaceForSeed`（Text Search），查到寫回快取
   （`upsertPlace`），每次呼叫間隔 150ms 避免 rate limit；查不到就跳過（保留 AI 給的文字，
   沒座標）。
4. **存進資料庫**（第669-685行）
   標題加 `[TEST-SEED]` 前綴，方便之後清除重跑。

---

## 流程二：正式 app（`/api/v1/generate-stream`，串流 + 背景補座標）

使用者實際互動用的路徑，為了「越快看到內容越好」的體驗，把座標補齊延後到背景：

1. **Google Places 抓 hints**（`generate-stream/route.ts` 第73-88行）
   同種子腳本的邏輯，多抓一組 `fetchCityAttractions`，組成 `hintsPrompt`
   （景點清單＋餐廳清單）。
2. **AI 串流生成**（第90-123行）
   OpenAI `stream: true`，每個 chunk 用 SSE `data: {type:"chunk"...}` 即時推給前端——
   使用者畫面上文字逐步「打出來」就是這裡。
3. **收尾驗證與存檔（此時還沒有真實座標）**（第125-207行）
   Zod schema 驗證 → 去掉最後一天 AI 幻覺出的 `isTransitDay` → `tagWaypointCities`
   → 多城市才跑 `repairTransitDayDepartureCities` → `validateItinerary`。
   有 error 級別問題直接回傳 error 事件、**不存檔**；只有 warning 才繼續存檔，
   此時 stop 只有 AI 給的名稱，沒有 `placeId/lat/lng`。
4. **前端載入後才背景觸發兩次 Google enrichment**
   （`EditableItineraryCard.tsx` 第508-550行）：
   - 逐天檢查 `accommodation` 沒有 `placeId` 就打 `/accommodation/enrich`
   - 打一次 `/api/v1/itinerary/{id}/enrich-all-stops`，內部對每個 stop/meal
     依序查快取 → 沒快取才打 Text Search（帶城市中心當 bias）→ 寫回 DB；
     並用「與同天其他景點中心點距離 >80km」的 heuristic 標記 `suspicious`，
     回傳給前端顯示警示（「N 個景點地點可能有誤」）。

---

## 流程三：編輯本日（day-level 景點建議，`/api/v1/days/[dayId]/stop-suggestions`）

跟前兩個流程的角色分工**反過來**：這裡是 **Google Places 決定候選清單本身，AI 只負責幫每個
候選寫描述，不負責挑地點**。用於使用者在單一天內刪掉不喜歡的景點後，系統推薦補齊選項。

1. **找錨點座標**（第117-137行）
   先看這一天現有 stops 裡有沒有帶座標的當錨點；若這天是全新空白日（還沒有任何座標），
   就去找同 `waypointCity` 的其他天，借一個座標當錨點——目的是盡量走 Google 搜尋，
   而不是直接落到純 AI 亂猜。
2. **用錨點跑 Google Nearby Search，分類型保底＋補洞**（第143-198行）
   - 4 種類型分開查：`tourist_attraction`、`museum`、`park`、`amusement_park`，
     半徑 **20km**（比餐廳提示的 8km 大很多，因為外圍地標如樂園也要能被搜到）
   - 每種類型各保留前 **3 筆**（`MIN_PER_TYPE`）當「保底」，維持 Google
     `rankPreference: POPULARITY` 原始排序，不用星等重排——避免熱門地標被冷門但高分的
     小場館擠掉
   - 保底湊不滿 16 筆（`POOL_SIZE`）時，用其他類型剩下的候選（overflow）依人氣序補滿
   - 過濾條件：排除「這天已存在的 stop 名稱/placeId」以及前端傳來的 `excludeNames`
     （對應「換一批」時排除已顯示過的）
3. **沒有 API key 或沒有錨點座標 → 退回純 AI 生成**（第200-203行）
   呼叫 `suggestFallbackText`，讓 AI 憑文字脈絡（行程標題、當日主題）生 8 個景點名稱，
   只告知「不要跟已用過的重複」；這種情況下地點是 AI 憑空生的、沒有真實座標，
   回傳時標記 `isFallback: true` 讓前端知道這批不保證真實。
4. **真實候選找到後，AI 只補描述、不能改名單**（第228-269行）
   把 Google 選出的候選名稱鎖死餵給 AI，prompt 明確要求「輸出必須是完全一樣的 N 個名稱、
   順序不變，只能填 `description` 跟 `duration_minutes`，不可增刪改名」。若 AI 沒照做，
   用名稱正規化比對去救回，救不回就退回用星等組出的通用描述
   （「靠近您行程中的景點，Google 評分 X★」）。
5. **事後距離合理性檢查（suspicious flag）**（第271-286行）
   算這天現有 stops 的中心點，每個候選離中心點若超過 **80km**（`SUSPICIOUS_KM`，
   跟 `enrich-all-stops` 用同一個門檻），就標 `suspicious: true` 附上原因，不會擋掉，
   只是給前端顯示警示。

**跟流程一/二的關鍵差異**：流程一、二是「Google 給素材 → AI 決定用哪些、怎麼排」；
流程三是「Google 直接決定候選清單（分類型保底＋人氣排序過濾）→ AI 只錦上添花寫文案」，
用嚴格 schema 檔住 AI 不能偷改名單。真的沒有真實資料可查時，才整批退回給 AI 自由生成，
並明確標記為 fallback。

---

## 三個流程的差異對照

| | 種子腳本 | 正式 app（整份生成） | 編輯本日（單天建議） |
|---|---|---|---|
| 用途 | 批量產生測試資料 | 使用者生成第一版行程 | 使用者刪掉本日景點後補齊 |
| 誰決定用哪些地點 | AI（Google 只給素材） | AI（Google 只給素材） | Google（分類型保底＋人氣排序），AI 不能改名單 |
| AI 呼叫方式 | 同步等完整結果 | 串流（SSE chunk） | 同步（僅補 description/duration） |
| 座標補齊時機 | 存檔前就做完 | 存檔後，前端載入時才背景觸發 | 建議清單產生時就帶真實座標（Google 決定候選時已一併取得） |
| 使用者等待體驗 | 不在意（batch script） | 優先：AI 開始輸出的時間越短越好 | 單天範圍小，同步等待可接受 |
| enrichment 失敗處理 | 跳過該筆，保留無座標的文字 | 同樣跳過，另外標 `suspicious` 給 UI 顯示警示 | 無 Google 候選/沒 API key 時整批退回純 AI 生成，標記 `isFallback` |
| 距離合理性檢查 | 無 | `enrich-all-stops` 事後跑 centroid + 80km 門檻 | 建議產生時就跑同樣的 centroid + 80km 門檻 |
| 核心順序 | Google → AI → Google | Google → AI → Google | Google（決定候選）→ AI（補文案） |

---

## 為什麼不把正式 app 改成跟種子腳本一樣的同步流程

種子腳本的 enrichment 是逐個 stop 依序打 Text Search、每次間隔 150ms——一個 10 天行程
可能有 40~60 個 stop/meal，同步跑完可能要多等 10-20+ 秒。若正式 app 也把這段搬到
「AI 生成完成」之前，會直接吃掉串流體驗的好處：使用者會變成整個空白等 20 秒，
而不是現在這樣邊看 AI 輸出文字邊等。

現有設計的代價是：生成完成後的短暫幾秒內，地圖／座標是空的，需要 `suspicious` 警示 UI
來補足「座標可能還沒補齊或補齊有誤」的溝通。若要改善，比較合理的方向是優化**背景
enrichment 本身**（例如把目前逐個序列呼叫改成有限度平行處理、或在 UI 上更明確顯示
「正在定位景點座標」的 loading 狀態），而不是整個搬回同步流程。
