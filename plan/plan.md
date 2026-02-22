# AI Travel Agent — 重構計畫

> 參考來源：https://github.com/wanyiyeh/ai-travel-planner
> 建立日期：2026-02-22

---

## 現況分析

| 項目 | 你的專案 (`ai-travel-agent`) | 參考專案 (`ai-travel-planner`) |
|---|---|---|
| 頁面 | Next.js 預設模板 | MVP 空白頁 |
| API | 無 | `/api/v1/generate` (POST) |
| DB Schema | User + Itinerary + Place | Itinerary + Place（無 User） |
| 套件 | 缺 `openai`, `zod`, `@prisma/client` | 有完整依賴 |
| Lib 工具 | 無 | `db.ts`, `openai.ts` |

你的專案架構比參考專案更完整（有 User 模型），但功能層是空的。

---

## Phase 1 — 基礎建設（直接移植）

**目標：補齊缺少的套件與 lib 工具層**

### 1.1 安裝缺少的套件

```bash
npm install openai zod @prisma/client
npm install -D prisma
```

### 1.2 建立 `src/lib/db.ts`

從參考專案移植。Prisma singleton pattern，防止開發環境 Hot Reload 產生過多連線。

```typescript
// src/lib/db.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

### 1.3 建立 `src/lib/openai.ts`

從參考專案移植。OpenAI client 初始化，含 API key 環境變數安全檢查。

```typescript
// src/lib/openai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

### 1.4 同步 Prisma Client

```bash
npx prisma generate
```

---

## Phase 2 — AI 行程生成 API（移植 + 升級）

**目標：建立核心 API，解決參考專案的 `userId` 硬編碼問題**

### 建立 `src/app/api/v1/generate/route.ts`

**移植自參考專案，升級項目如下：**

| 參考專案 | 升級版 |
|---|---|
| `userId: "demo-user"` 硬編碼 | 從 request body 取得 `userId`（先用參數傳遞） |
| 無 input validation | Zod 驗證 `prompt`、`days`、`userId` |
| model 寫死 `gpt-4o-mini` | 可透過 `OPENAI_MODEL` env 配置 |

**Zod Schema：**
```typescript
const RequestSchema = z.object({
  prompt: z.string().min(1),
  days: z.number().int().min(1).max(14),
  userId: z.string().optional().default("demo-user"),
});

const ItinerarySchema = z.object({
  title: z.string(),
  days: z.array(
    z.object({
      day_index: z.number(),
      stops: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        })
      ),
    })
  ),
});
```

**API 端點：**
- Method: `POST`
- Path: `/api/v1/generate`
- Body: `{ prompt: string, days: number, userId?: string }`
- Response: `{ message, id, data: { title, days[] } }`

---

## Phase 3 — 前端 UI

**目標：建立可用的行程生成頁面（參考專案頁面為空，全部自建）**

### 3.1 首頁表單 (`app/page.tsx`)

- 輸入目的地（`prompt`）
- 選擇天數（`days`，1–14 天）
- 送出按鈕，呼叫 `POST /api/v1/generate`
- Loading state / Error state 處理

### 3.2 行程結果顯示

- 展示 AI 回傳的每日行程（`days` JSON）
- 每天的景點卡片清單（`stops`）
- 顯示行程標題（`title`）

### 3.3 已儲存行程列表頁 (`app/itineraries/page.tsx`)

> 參考專案沒有此功能

- 列出資料庫中所有已生成的行程
- 顯示標題、建立時間
- 連結到詳細頁

---

## Phase 4 — 進階功能（你的專案獨有）

**目標：利用 User + Place 模型，做參考專案做不到的事**

### 4.1 User 身份識別

- 整合 NextAuth.js 或簡易 session 機制
- 行程與用戶真正綁定（取代 `demo-user`）

### 4.2 Google Places API 整合

你的 `Place` 模型已有 `photoRef`、`rating`、`address`、`location` 等欄位，可整合：

- 對 AI 回傳的景點名稱查詢真實地點資料
- 快取到 `Place` table，避免重複呼叫 API
- 需新增 env：`GOOGLE_PLACES_API_KEY`

### 4.3 行程詳細頁 (`app/itineraries/[id]/page.tsx`)

- 顯示單一行程完整內容
- 每個景點顯示真實地點資訊（地址、評分）
- Google Places Photos API 顯示景點照片

---

## 執行順序

```
Phase 1  套件安裝 + lib/db.ts + lib/openai.ts    → 直接移植，30 分鐘內完成
Phase 2  API route /api/v1/generate               → 核心功能，先用 curl 測試
Phase 3  前端 UI 表單 + 結果顯示                  → 可用產品
Phase 4  User 綁定 + Google Places               → 差異化功能
```

---

## 檔案結構目標

```
src/
├── app/
│   ├── api/
│   │   └── v1/
│   │       └── generate/
│   │           └── route.ts        ← Phase 2
│   ├── itineraries/
│   │   ├── page.tsx                ← Phase 3.3
│   │   └── [id]/
│   │       └── page.tsx            ← Phase 4.3
│   ├── page.tsx                    ← Phase 3.1
│   ├── layout.tsx
│   └── globals.css
└── lib/
    ├── db.ts                       ← Phase 1.2
    └── openai.ts                   ← Phase 1.3
```
