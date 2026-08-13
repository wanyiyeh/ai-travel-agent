# src/hooks 目錄分析筆記

> 最後更新：2026-07-05

`src/hooks` 目前只有一支自訂 React Hook，負責封裝行程生成的 SSE（Server-Sent Events）串流邏輯，讓元件不需要直接處理 `fetch` + `ReadableStream` 的細節。

## 檔案總覽

| 檔案 | 用途 |
|---|---|
| `useStreamingGenerate.ts` | 呼叫 `/api/v1/generate-stream`，解析 SSE 串流回應，管理生成狀態機 |

---

## 1. `useStreamingGenerate.ts` — 行程生成串流狀態機

### 用途
封裝「呼叫生成 API → 讀取串流 chunk → 更新 UI 狀態」整個流程。元件只需要呼叫 `generate()`，不用自己處理 `ReadableStreamDefaultReader`、SSE 訊息格式解析、或 buffer 斷行處理。

### 狀態機

```
idle --generate()--> connecting --response.ok--> streaming --data.type=complete--> complete
                          |                            |
                          +--------- error ------------+--> error
```

| 狀態 | 說明 |
|---|---|
| `idle` | 初始狀態，尚未呼叫 `generate()` |
| `connecting` | 已送出 POST 請求，等待 response |
| `streaming` | 已建立連線，正在讀取 SSE chunk |
| `complete` | 收到 `type: "complete"` 訊息，`result` 已可用 |
| `error` | 連線失敗、`response.ok` 為 false，或收到 `type: "error"` 訊息 |

### 回傳值

| 欄位 | 型別 | 說明 |
|---|---|---|
| `state` | `StreamingState` | 目前狀態（見上表） |
| `partialData` | `string` | 串流過程中的中間內容，用於顯示生成進度預覽 |
| `result` | `Itinerary \| null` | 生成完成後的完整行程資料 |
| `id` | `string \| null` | 生成完成後的行程 ID（用於導頁到 `/itinerary/[id]`） |
| `error` | `string` | 錯誤訊息 |
| `isLoading` | `boolean` | `state` 為 `connecting` 或 `streaming` 時為 `true`，方便 UI 直接綁 disabled/spinner |
| `generate(prompt, flightInfo, preferences?)` | `function` | 觸發生成，內部會先重置所有狀態 |
| `reset()` | `function` | 手動重置回 `idle`（例如使用者按「重新開始」） |

### SSE 訊息格式（對應 `generate-stream/route.ts`）
後端以 `data: {...}\n\n` 格式逐行推送，每行 JSON 帶有 `type` 欄位：

| `type` | 對應動作 |
|---|---|
| `chunk` | 更新 `partialData`（顯示目前累積的生成內容） |
| `complete` | 寫入 `result` / `id`，`state` 轉為 `complete` |
| `error` | 寫入 `error`（格式為 `"${error}: ${details}"`），`state` 轉為 `error` |

### 實作細節
- 用 `TextDecoder` + buffer 手動處理跨 chunk 斷行：每次讀取的 chunk 可能在一行 JSON 中間被切斷，所以用 `buffer.split("\n")` 後把最後一行（可能不完整）留到下一輪再拼接。
- `JSON.parse` 失敗會被靜默吞掉（`catch {}`），因為不完整的行本來就預期解析失敗，等下一個 chunk 補齊後才會是合法 JSON。
- 兩個 catch 層：外層 `try/catch` 處理連線層級錯誤（fetch 失敗、`response.body` 為 null），內層在 SSE 訊息解析迴圈內處理逐行 JSON 錯誤，兩者互不干擾。

### 被誰使用
- `src/app/page.tsx`：首頁生成表單，呼叫 `generate()` 送出生成請求，並依 `state`/`partialData` 顯示對應 UI（loading、串流預覽、完成後導頁）。
- 搭配 `src/components/StreamingPreview.tsx` 顯示 `partialData` 的即時預覽。

### 注意事項
- `generate` 和 `reset` 都用 `useCallback([])` 包裹，依賴陣列為空——因為函式內部只用 `setState` 系列的 setter（穩定引用），沒有依賴外部 closure 變數，所以可以放心用空陣列而不會有 stale closure 問題。
- 目前只有一支生成流程接了串流；其他如 accommodation regenerate、stop regenerate 等單次生成的 route 是一般 JSON response，沒有走這支 Hook 的串流模式。
