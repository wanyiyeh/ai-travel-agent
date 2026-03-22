# ItineraryMap 每日路線實作說明

## 問題

原本的 `ItineraryMap.tsx` 把所有天數的地點一次攤平顯示在地圖上，沒有路線連線，也無法單獨檢視某一天的行程。

---

## 實作方式

### 1. 元件拆分：`MapContent` + `ItineraryMap`

`useMap()` hook 必須在 `<Map>` 元件的子樹內才能取得 map instance，因此拆出一個內部元件 `MapContent`：

```
<APIProvider>
  <Map>
    <MapContent />   ← 在這裡才能呼叫 useMap()
  </Map>
</APIProvider>
```

`ItineraryMap`（主元件）負責：
- 管理所有 state（stops、選中天數、選中 stop）
- 資料 enrichment（呼叫 `/api/v1/stops/:id/enrich`）
- 天數切換 UI

`MapContent`（內部元件）負責：
- 用 `useMap()` 拿到 map instance
- 繪製 Polyline
- 自動 fitBounds
- 渲染 `AdvancedMarker` 與 `InfoWindow`

---

### 2. 天數切換

新增 state：

```ts
const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
// null = 全部天數
// 0, 1, 2... = 第幾天（以 dayIndex 計）
```

UI 為一排 pill buttons，「全部天數」＋各天按鈕。active 狀態用該天的顏色填色，非 active 改為 outline 樣式。

切換天數時同時清除 `selectedStop`（避免 InfoWindow 殘留）。

---

### 3. 過濾可見 stops

```ts
const visibleStops =
  selectedDayIndex === null
    ? mapStops
    : mapStops.filter((s) => s.dayIndex === selectedDayIndex);
```

`visibleStops` 傳給 `MapContent`，所有地圖操作都只針對這組資料。

---

### 4. Polyline 路線繪製

在 `MapContent` 內用 `useEffect` 監聽 `visibleStops` 變化，用 Google Maps JS API 命令式繪製：

```ts
const dayGroups: Record<number, MapStop[]> = {};
visibleStops.forEach((stop) => {
  if (!dayGroups[stop.dayIndex]) dayGroups[stop.dayIndex] = [];
  dayGroups[stop.dayIndex].push(stop);
});

Object.entries(dayGroups).forEach(([key, stops]) => {
  const dayIndex = Number(key);
  const sorted = [...stops].sort((a, b) => a.stopIndex - b.stopIndex);
  const path = sorted.map((s) => ({ lat: s.lat, lng: s.lng }));

  new google.maps.Polyline({
    path,
    strokeColor: DAY_COLORS[dayIndex % DAY_COLORS.length],
    strokeOpacity: 0.75,
    strokeWeight: 3,
    map,
    icons: [{ icon: { path: FORWARD_CLOSED_ARROW, scale: 3 }, offset: "100%" }],
  });
});
```

- 按 `stopIndex` 排序，確保路線順序正確
- 末端加箭頭（`FORWARD_CLOSED_ARROW`）指示方向
- `useEffect` cleanup 呼叫 `polyline.setMap(null)` 清除舊線，避免重複疊加

> **注意**：不能用 JS 內建 `new Map()`，因為 `@vis.gl/react-google-maps` 匯出的 `Map` component 會遮蔽它。改用 `Record<number, MapStop[]>` + `Object.entries()`。

---

### 5. 自動 fitBounds

每次 `visibleStops` 改變（包含切換天數、enrichment 完成），自動將地圖縮放到所有可見點的範圍：

```ts
useEffect(() => {
  if (!map || visibleStops.length === 0) return;
  const bounds = new google.maps.LatLngBounds();
  visibleStops.forEach((s) => bounds.extend({ lat: s.lat, lng: s.lng }));
  map.fitBounds(bounds, 60); // 60px padding
}, [map, visibleStops]);
```

---

## 資料流總覽

```
days (props)
  └─ enrichment useEffect
       ├─ 已有座標 → setMapStops (直接加入)
       └─ 無座標 → POST /api/v1/stops/:id/enrich → setMapStops (逐筆加入)

mapStops
  └─ filter by selectedDayIndex
       └─ visibleStops
            ├─ MapContent: fitBounds
            ├─ MapContent: Polyline
            └─ MapContent: AdvancedMarker / InfoWindow
```
