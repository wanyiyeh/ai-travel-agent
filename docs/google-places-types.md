# Google Places API 分類（Place Types）

Google Places 用 `types` / `includedTypes` 來描述及篩選一個地點的分類。這份筆記整理目前有哪些分類、怎麼用，以及本專案實際用到哪些。

---

## 1. 兩種分類表

Google 官方把 Place Types 分成兩個表：

| | Table A | Table B |
|---|---|---|
| **用途** | 可用於 `includedType(s)` / `excludedType(s)` 篩選搜尋結果 | 只會出現在回傳結果的 `types` 欄位裡，**不能拿來篩選** |
| **特性** | 分類明確、數量多（200+ 種） | 範圍籠統（如 `establishment`, `point_of_interest`, `food`） |
| **建議用法** | Nearby Search / Text Search 的 `includedTypes` 參數 | 顯示用途，例如判斷這個地點「大致上」是什麼 |

本專案的 `includedTypes: [...]`（見 [fetchCityRestaurants.ts](../src/lib/fetchCityRestaurants.ts)）都是用 Table A 的分類。

---

## 2. Table A 常用分類（依旅遊情境分組）

### 餐飲
`restaurant`、`cafe`、`bar`、`bakery`、`meal_takeaway`、`meal_delivery`、`fast_food_restaurant`、`fine_dining_restaurant`、`ice_cream_shop`、`breakfast_restaurant`、`brunch_restaurant`、`diner`

### 住宿
`lodging`、`hotel`、`motel`、`resort_hotel`、`guest_house`、`hostel`、`bed_and_breakfast`、`campground`、`rv_park`

### 景點 / 娛樂
`tourist_attraction`、`museum`、`art_gallery`、`park`、`national_park`、`amusement_park`、`zoo`、`aquarium`、`night_club`、`casino`、`movie_theater`、`stadium`、`historical_landmark`、`monument`

### 購物
`shopping_mall`、`store`、`clothing_store`、`supermarket`、`convenience_store`、`department_store`、`gift_shop`、`market`

### 交通
`airport`、`train_station`、`subway_station`、`bus_station`、`transit_station`、`parking`、`taxi_stand`、`car_rental`

### 服務 / 民生
`bank`、`atm`、`hospital`、`pharmacy`、`police`、`gas_station`、`post_office`、`spa`

> 完整清單（200+ 種）請參考官方文件：[Table A - Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types#table-a)

---

## 3. Table B（舊版廣泛分類，僅供參考）

`establishment`、`point_of_interest`、`food`、`health`、`general_contractor` 等。這些分類太籠統，Google 官方明確建議**不要**用於 `includedTypes` 篩選，只會在結果的 `types[]` 裡出現。

---

## 4. 新版 API（Places API New）的分類機制

新版 Nearby Search / Text Search（本專案使用的版本）用三個欄位處理分類：

| 欄位 | 說明 |
|------|------|
| `includedTypes` | 請求參數，指定只回傳這些分類（陣列，OR 邏輯） |
| `excludedTypes` | 請求參數，排除這些分類 |
| `types` / `primaryType` | 回應欄位，`types` 是完整分類列表，`primaryType` 是主分類 |

---

## 5. 本專案目前用到的分類

| 分類 | 用途 | 使用位置 |
|------|------|----------|
| `breakfast_restaurant`、`brunch_restaurant`、`cafe`、`bakery` | 早餐推薦（AI 提示用）——`restaurant` 多數不供應早餐，故早餐改用獨立清單；納入 `breakfast_restaurant`/`brunch_restaurant` 是為了不侷限於西式咖啡館／麵包店，也能涵蓋日式定食屋等當地早餐店 | [fetchCityRestaurants.ts `fetchCityBreakfastPlaces()`](../src/lib/fetchCityRestaurants.ts) |
| `restaurant`（budget 再疊加 `fast_food_restaurant`，luxury 再疊加 `fine_dining_restaurant`） | 午餐、晚餐推薦（AI 提示用） | [fetchCityRestaurants.ts `fetchCityRestaurants()`](../src/lib/fetchCityRestaurants.ts) |
| `tourist_attraction` | 景點推薦（AI 提示用） | [fetchCityRestaurants.ts `fetchCityAttractions()`](../src/lib/fetchCityRestaurants.ts) |
| `tourist_attraction`、`museum`、`park`、`amusement_park` | 單日行程點的候選地點（可直接加入行程） | [stop-suggestions/route.ts:126](../src/app/api/v1/days/[dayId]/stop-suggestions/route.ts#L126) |
| `hotel`、`resort_hotel`、`hostel`、`guest_house`、`bed_and_breakfast`、`motel`、`lodging`（依旅客預算挑選子集） | 住宿地點候選（重新產生住宿建議），並將 AI 選中的候選之 `placeId`/`lat`/`lng`/`address`/`rating` 寫回住宿資料 | [accommodation/regenerate/route.ts](../src/app/api/v1/days/[dayId]/accommodation/regenerate/route.ts)、[fetchCityRestaurants.ts `getLodgingTypes()`](../src/lib/fetchCityRestaurants.ts) |

`fetchNearbyPlaceCandidates()` 接受任意 `types: string[]`（以及選填的 `priceLevels`），代表這個函式已經可以直接餵入 Table A 的其他分類（例如 `shopping_mall`、`night_club`、`spa`），不需要改程式碼即可擴充搜尋範圍。

---

## 6. 可能值得加入的分類（依需求擴充）

- 想加「購物行程」→ `shopping_mall`、`market`
- 想加「夜生活」→ `bar`、`night_club`
- 想加「自然/戶外」→ `national_park`、`hiking_area`（部分地區）
- 想加「文化」→ `historical_landmark`、`monument`

擴充時只需在呼叫 `fetchNearbyPlaceCandidates` 時傳入對應的 `types` 陣列即可。

---

## 參考資料

- [Table A - Place Types (Google 官方文件)](https://developers.google.com/maps/documentation/places/web-service/place-types#table-a)
- [Nearby Search (New) API 文件](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
