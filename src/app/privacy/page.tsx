import type { Metadata } from "next";
import Link from "next/link";
import { SESSION_MAX_AGE_S } from "@/auth";
import { GUEST_COOKIE, GUEST_TTL_MS } from "@/lib/auth/guest";
import { RATE_LIMIT_WINDOW_RETENTION_MS, USAGE_RETENTION_MS } from "@/lib/housekeeping";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S } from "@/lib/requestFingerprint";

export const metadata: Metadata = { title: "隱私權說明 — AI Travel Agent" };

// The periods below are read from the code that enforces them, so this page
// changes with it (#261).
const UPDATED = "2026-10-29";
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (ms: number) => Math.round(ms / DAY_MS);

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <div className="mt-3 space-y-3 text-zinc-700 dark:text-zinc-300 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <article className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">隱私權說明</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">最後更新：{UPDATED}</p>
        <p className="mt-6 text-zinc-700 dark:text-zinc-300 leading-relaxed">
          這是一個個人作品集專案：輸入航班與偏好，產生旅遊行程。這一頁說明網站收集哪些資料、用來做什麼、保存多久，以及怎麼刪除。網站沒有廣告，也沒有任何分析或追蹤工具。
        </p>

        <Section title="收集哪些資料">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>用 Google 登入時</strong>：Google 提供的 email 與名字。網站不會收到你的 Google 密碼，也不保存 Google 的授權金鑰。
            </li>
            <li>
              <strong>你產生的行程</strong>：航班、日期、偏好、你輸入的文字，以及產生出來的行程內容。
            </li>
            <li>
              <strong>使用紀錄</strong>：每次產生或修改行程的時間、經過雜湊處理的 IP，以及裝置代碼，用來計算每日額度。
            </li>
            <li>
              <strong>Cookie</strong>：
              <ul className="list-[circle] pl-5 mt-1 space-y-1">
                <li>
                  <code>{DEVICE_COOKIE}</code>：隨機產生的裝置代碼，用來計算每個裝置的額度，保存 {days(DEVICE_COOKIE_MAX_AGE_S * 1000)} 天。
                </li>
                <li>
                  <code>{GUEST_COOKIE}</code>：未登入就產生行程時，用來辨認是你的行程，保存 {days(GUEST_TTL_MS)} 天。
                </li>
                <li>登入狀態的 cookie：登入後最長維持 {days(SESSION_MAX_AGE_S * 1000)} 天，登出即清除。</li>
              </ul>
            </li>
          </ul>
          <p>
            IP 只以雜湊後的形式存進資料庫：可以判斷「是不是同一個 IP」，但無法從資料庫還原出你的 IP。
          </p>
        </Section>

        <Section title="用途">
          <ul className="list-disc pl-5 space-y-1">
            <li>登入與保存你的行程，讓你之後可以再打開、修改</li>
            <li>計算每日額度、限制請求頻率，防止濫用與意外的費用</li>
          </ul>
          <p>不會用於廣告，不會出售或提供給他人做行銷。</p>
        </Section>

        <Section title="保存多久">
          <ul className="list-disc pl-5 space-y-1">
            <li>未登入時產生的行程：{days(GUEST_TTL_MS)} 天後自動刪除；期限內用 Google 登入，行程會移到你的帳號下</li>
            <li>登入後的行程：保存到你自己刪除行程或刪除帳號</li>
            <li>使用紀錄：{days(USAGE_RETENTION_MS)} 天後自動刪除</li>
            <li>限制請求頻率的計數（雜湊後的 IP）：最多 {days(RATE_LIMIT_WINDOW_RETENTION_MS)} 天</li>
          </ul>
        </Section>

        <Section title="會經手資料的第三方服務">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Google</strong>：登入；地點資料由網站伺服器向 Google 查詢，不會附上你的個人資料。地圖與「照片與詳情」視窗則在你的瀏覽器中直接向 Google 載入，Google 會收到你的 IP 等連線資訊。
            </li>
            <li>
              <strong>OpenAI</strong>：規劃城市、天數與交通時，會送出你的旅行條件與輸入的文字（不含你的 email 或名字）。網站已設定不分享資料給 OpenAI 訓練模型；OpenAI 依其政策可能保留 API 資料一段時間，用於偵測濫用。
            </li>
            <li>
              <strong>Cloudflare Turnstile</strong>：產生行程前的人機驗證，會收到你的 IP 與瀏覽器資訊。
            </li>
            <li>
              <strong>Vercel</strong>：網站主機，會記錄一般的連線紀錄。
            </li>
            <li>
              <strong>Neon</strong>：資料庫主機（新加坡），存放上面列出的資料。
            </li>
          </ul>
        </Section>

        {/* World Bank data is CC BY 4.0, which asks for this credit (ADR-0011). */}
        <Section id="data-sources" title="資料來源">
          <p>
            機場清單與城市資料來自公開資料：
            <a href="https://ourairports.com/data/" className="underline underline-offset-4 mx-1">
              OurAirports
            </a>
            （公有領域）與
            <a href="https://www.wikidata.org/" className="underline underline-offset-4 mx-1">
              Wikidata
            </a>
            （CC0）。
          </p>
          <p>
            各國物價水準用來粗估餐費、門票與住宿，由世界銀行的購買力平價換算係數（PA.NUS.PPP）與官方匯率（PA.NUS.FCRF）計算：
            The World Bank,
            <a href="https://data.worldbank.org/" className="underline underline-offset-4 mx-1">
              World Development Indicators
            </a>
            ，以
            <a href="https://creativecommons.org/licenses/by/4.0/" className="underline underline-offset-4 mx-1">
              CC BY 4.0
            </a>
            授權。網站只取兩者的比例做估算，世界銀行未審閱或認可這些估算。
          </p>
        </Section>

        <Section title="怎麼刪除">
          <ul className="list-disc pl-5 space-y-1">
            <li>單一行程：在「已儲存的行程」裡刪除。</li>
            <li>
              整個帳號：登入後到
              <Link href="/account" className="underline underline-offset-4 mx-1">
                帳號頁
              </Link>
              刪除，帳號、所有行程與使用紀錄會立即永久刪除。
            </li>
            <li>
              Google 登入授權：網站沒有保存，請到 Google 帳戶的「第三方連結」自行移除。
            </li>
            <li>未登入時產生的資料：不需要處理，期限到了會自動刪除；也可以清除瀏覽器的 cookie。</li>
          </ul>
        </Section>
      </article>
    </div>
  );
}
