# 資料來源

網站用到的外部資料：從哪裡來、在哪裡用、條款限制、要不要付費、怎麼標示出處。主機與資料庫（Vercel、Neon）見 [deploy.md](deploy.md)。

## 執行時呼叫的服務

| 來源 | 提供什麼 | 程式碼 | 費用 | 條款與出處 |
| --- | --- | --- | --- | --- |
| Google Places API (New)、Routes API | 景點、餐廳、住宿、城市中心、路線時間 | 全部經過 `src/lib/googleFetch.ts` | 付費（量測見 [runbook](runbook.md)） | 只能存 place ID 與 30 天內的座標（[ADR-0004](adr/0004-google-maps-content-storage.md)）；不放進 LLM 輸入（[ADR-0008](adr/0008-no-google-content-in-llm-input.md)）；畫面標示見 `.claude/rules/google-places.md` |
| OpenAI | 規劃城市與天數、寫行程文案 | `src/lib/openai.ts` | 付費 | 不送使用者的 email 或名字（見隱私權頁） |
| Open-Meteo | 去年同月的天氣，判斷海灘、滑雪是否合適 | `src/lib/climate.ts` | 免費，僅限非商業使用 | CC BY 4.0，出處尚未標示（#307） |
| ExchangeRate-API（open.er-api.com） | 每日匯率，換算費用估算 | `src/lib/exchangeRate.ts` | 免費 | 免費版要求標示出處，尚未標示（#307） |

## 產生資料檔用的來源

由 `npm run build-airports`（`scripts/build-airports.ts`）下載、合併成 `src/data/airports.generated.json` 與 `countries.generated.json` 並提交進 git，網站執行時不連這些來源（[ADR-0011](adr/0011-airport-data-from-open-sources.md)）。更新步驟見 [runbook](runbook.md#更新機場與國家資料)。

| 來源 | 提供什麼 | 授權 | 出處 |
| --- | --- | --- | --- |
| [OurAirports](https://ourairports.com/data/) | 有定期航班的大型與中型機場、IATA 代碼、機場座標 | 公有領域 | 不需要，仍列在隱私權頁 |
| [Wikidata](https://www.wikidata.org/)（SPARQL） | 機場服務的城市、繁中與英文城市名、城市座標、國家、貨幣、國家中文名 | CC0 | 不需要，仍列在隱私權頁 |
| [世界銀行 World Development Indicators](https://data.worldbank.org/) | 購買力平價換算係數（`PA.NUS.PPP`）與官方匯率（`PA.NUS.FCRF`），兩者的比例是各國物價水準 | CC BY 4.0 | 隱私權頁的「資料來源」段落（`src/app/privacy/page.tsx`），頁尾有連結 |

人工清單 `src/lib/airports.ts` 的城市名與座標優先於生成資料，見 [機場](features/airports.md)。
