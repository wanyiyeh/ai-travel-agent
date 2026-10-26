---
status: in-progress      # draft | approved | in-progress | done
branch: plan-002-llm-without-google-content
issue: 262
created: 2026-10-25
---

# PLAN-002：LLM 的輸入不放 Google 內容，Google 地點的文案改用模板

## 目標

避開服務條款 3.2.3(c)「以 Google Maps 內容創作內容」的灰色地帶，讓作品集公開（#215）前確定合規。做法與取捨見 [ADR-0008](../adr/0008-no-google-content-in-llm-input.md)。

## 非目標

- 不改地點的來源與挑選方式（Google 候選池＋規則引擎照舊）
- 不改成由 LLM 提出景點名稱（#226）
- 不讓文案寫出地點特色（營利前另行評估有授權的內容來源，#227）
- 不接開放資料（#227）
- 不動 LLM 自己提出名稱的流程（季節亮點、經典一日遊、影劇取景）：輸入本來就沒有 Google 內容

## 驗收條件

- 所有 OpenAI 呼叫的輸入都不包含 Google 回傳的名稱、地址、評分、類型、評論；由守門測試證明（假地點的名稱用特殊字串，檢查每一次呼叫的 messages）
- Google 地點的文案只用模板：主題日的第一站「今天的〇〇從這裡開始」、整天行程的最後一站「今天的最後一站」，其他站留白；程式原本就寫的實用說明照舊保留
- 生成、補文案、景點建議、加景點都不再呼叫 OpenAI 為 Google 地點寫文案
- `translatePlaceNames` 移除，名稱顯示 Google 的 `zh-TW` 名稱
- 原本由 LLM 判斷的 `partOf`（同一地點的不同名稱、鳥居與神社）依設計摘要的決定處理
- 舊的整段生成 fallback 的 prompt 不再放 Google 餐廳名稱
- `npm run lint`、`npx tsc --noEmit`、`npm test`、`npm run test:integration` 通過

## 邊界情況

- 使用者自己輸入的名稱（固定行程、手動輸入的景點、必去景點）可以交給 LLM；從 Google 搜尋結果選的地點不行
- 一天只有一個景點：不標「最後一站」
- Google 沒有中文名稱：顯示原文，不補翻譯
- 移動日、交通項目、沒有 place ID 的項目：維持現有文案
- mock 模式（`MOCK_AI=1`）：拿掉的呼叫點一併移除 `mockAi.ts` 的假回應

## 成本

- 開發與測試：`npm test`、`npm run test:integration`、`npm run dev:free`，免費
- 畫面確認：完成後用 `npm run dev:free` 生成一次看列表（免費）
- 不需要真實 Google 呼叫

## 設計摘要

- 模板在 `src/lib/skeletonCopy.ts` 的 `buildStopCopy`，只用規則引擎排出的順序與當天主題（[ADR-0008](../adr/0008-no-google-content-in-llm-input.md)）
- 不用從 Google 類型轉換來的分類寫文案
- 文案沿用 `description` 欄位，不改 schema 與 `placeStorage.ts` 的白名單
- LLM 產生的整天主題句（`dayTheme`）沒有任何地方使用，一併移除；天的標題由 `cityStayDays.ts` 產生
- `partOf`（名稱不同、其實是同一處，例如神社與它的鳥居）改用 Google 的 `containingPlaces`，在建立候選池時排除（`placeCandidatesToStopCandidates`），空出的位置由規則引擎補上；LLM 的 `partOf` 一併移除。A 的 `containingPlaces` 有池中的 B、兩者在距離上限內、名稱開頭不同，且 B 不是公園類、A 不是獨立目的地類（博物館、動物園等），A 才不進候選池。類型清單見 `src/lib/scheduler/placeCandidatesToStopCandidates.ts`。
  - 是 Pro 欄位、只含 place ID；候選查詢的 field mask（`src/lib/fetchCityRestaurants.ts` 的 `PRO_FIELD_MASK`）本來就是 Pro 以上，加進去不多付錢。只在同一請求內由程式使用，不存、不給 LLM
  - 沿用 `PART_OF_MAX_KM` 的距離上限，以及「`isRelatedPlace` 成立的兩站保留」的現有行為（淺草寺與雷門照舊排成相鄰兩站）
  - 被併入的子地點不再寫進主地點的文案
  - 2026-10-25 實測 5 組（Place Details 10 次）：伏見稻荷大社／千本鳥居、箱根神社／和平鳥居、東大寺／二月堂、淺草寺／雷門都由子地點的 `containingPlaces` 連到主地點；倫敦塔／倫敦塔橋沒有連結（正確）；`subDestinations` 全部是空的，不使用。第二次實測 3 組（Place Details 6 次）：東大寺的 `containingPlaces` 是奈良公園、箕面大瀑布的是明治之森箕面國定公園，所以需要「公園類不當主地點」的條件；東京國立博物館沒有連到上野恩賜公園
  - 中英文名稱各一筆的重複抓不到，列為已知限制（#272）
- 景點建議的排除清單改成在 LLM 回應後用 place ID 過濾

## 任務拆解

1. 守門測試：攔截所有 OpenAI 呼叫，假地點名稱出現在輸入就失敗（先寫，現在應該會失敗）（#263）
2. `partOf` 改用 `containingPlaces`：候選查詢加欄位、`mockPlaces.ts` 補假資料、規則判斷與測試（#264）
3. 生成主流程：`skeletonCopy.ts` 改成模板、拿掉 OpenAI 呼叫（#265）
4. 補文案：`missingCopy.ts` 不再呼叫 OpenAI 為 Google 地點寫文案（#266）
5. 編輯路由：加景點（`stops`）、景點建議（`stop-suggestions`）不再為 Google 地點寫 LLM 文案，排除清單改用 place ID（#267）
6. 移除 `translatePlaceNames` 與呼叫點（#268）
7. 舊的整段生成 fallback：拿掉 `restaurantHintsPrompt`（#269）
8. 移動日規劃不把已去過的地點名稱交給 LLM（#276）
9. 餐點與住宿改由規則挑選，不把 Google 候選交給 LLM；設計先給使用者確認（#277）
10. 清除既有行程裡用舊作法寫的文案，執行前先列出影響範圍請使用者確認（#270）
11. 文件：功能頁、`.claude/rules/google-places.md` 加一條「LLM 輸入不放 Google 內容」（#271）

## 完成後遷移清單

- [ ] 功能頁：生成與編輯相關頁面說明文案的來源
- [ ] ADR：docs/adr/0008-no-google-content-in-llm-input.md 改為 Accepted
- [ ] glossary 新詞（若有）
