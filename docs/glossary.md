# 詞彙表

文件與溝通用左欄的中文，程式碼用右欄的識別字，不自創同義詞。新詞在功能完成時加入。

## 行程結構

| 詞 | 程式碼 | 定義 |
| --- | --- | --- |
| 行程 | `Itinerary` | 一趟旅行的完整內容，`days` 存成 JSON |
| 天 | `Day` | 行程中的一天，包含景點、三餐、住宿 |
| 景點 | `Stop` | 一天中要去的地方，有時段與停留時間 |
| 時段 | `time_of_day` | `morning`、`afternoon`、`evening` |
| 住宿 | `Accommodation` | 當晚住的地方 |
| 三餐 | `DayMeals` / `Meal` | 早、午、晚餐，加上點心（`snack`）與睡前小酌（`nightcap`） |
| 移動日 | `isTransitDay` / `transitTo` | 從一個城市移動到下一個城市的那天 |
| 交通站 | `kind: "transit"` / `isTransitStop` | 移動日裡代表城市之間交通的那一站，不是地點，不能拖拉或替換（ADR-0009） |
| 中途城市 | `waypointCity` | 去程與回程之間插入的城市 |
| 回程日 | （沒有欄位，`days` 的最後一天） | 搭回程班機的那一天 |
| 鎖定 | `isLocked` | 使用者鎖住、重新規劃時不會被改動的天 |
| 主題日 | `theme` | 依興趣主題安排的一天（美食、購物等），見 `src/lib/dayThemes.ts` |
| 固定行程 | `fixedEvent` / `FixedEventInfo` | 使用者已預訂、有固定時間的景點或餐點，不可被替換 |

## 生成流程

| 詞 | 程式碼 | 定義 |
| --- | --- | --- |
| 行程規劃 | `planTrip()` / `TripPlan` | 決定城市順序與各城市天數的那一步 |
| 偏好意圖 | `PreferenceIntent` | 從使用者自由文字解析出的結構化偏好 |
| 步調 | `Pace` | `relaxed`、`moderate`、`intensive` |
| 預算等級 | `BudgetLevel` | `budget`、`moderate`、`luxury` |
| 規則引擎 | `src/lib/scheduler/` | 不靠 LLM、決定景點分配、順序與時段的純函式 |
| 骨架 | `buildDaySkeleton()` | 規則引擎排出的一天：有哪些景點、順序、時段 |
| 候選池 | `StopCandidate` 等 | 從 Google 取得、可以排進行程的真實地點 |
| 種子 | seed（`partitionCandidatesByDay`） | 一天從哪個地點開始排，其他景點圍繞它 |
| 重新規劃 | restructure | 「重新規劃行程」精靈，以城市為單位重建 `days` |

## 地點資料

| 詞 | 程式碼 | 定義 |
| --- | --- | --- |
| 補資料 | enrich | 用 Google 為景點補座標、地址、評分、照片 |
| 補資料失敗 | `enrichFailure` | 記在項目上的查詢失敗，一段時間內不重查 |
| 可疑地點 | `suspicious` | 離預期城市太遠，可能比對到別處的同名地點 |
| 地點快取 | `Place` / `PlaceQuery` | 查詢字串到 Google 地點的快取 |

## 使用者

| 詞 | 程式碼 | 定義 |
| --- | --- | --- |
| 訪客 | `isGuest` | 未登入、以簽章 cookie 識別的使用者，行程會過期 |
| 額度 | quota（`src/lib/quota.ts`） | 每個使用者、IP、裝置可生成的次數上限 |
