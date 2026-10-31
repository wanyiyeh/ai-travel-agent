/**
 * Credits the free data sources ask for wherever their data is shown
 * (terms checked 2026-10-31, #307). Kept small and in the page's own style,
 * which both allow. The full list is on /privacy#data-sources.
 */

const linkClass = "underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300";

/**
 * Open-Meteo (CC BY 4.0): a link next to where its data appears, the licence,
 * and that it was changed — the day notes summarise last year's weather.
 */
export function OpenMeteoCredit({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-zinc-400 dark:text-zinc-500 ${className}`}>
      天氣提醒由去年同期的天氣整理而成：
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className={linkClass} translate="no">
        Weather data by Open-Meteo.com
      </a>
      （
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className={linkClass}>
        CC BY 4.0
      </a>
      ）
    </p>
  );
}

/** ExchangeRate-API's open access endpoint: a link on pages using its rates. */
export function ExchangeRateCredit({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-zinc-400 dark:text-zinc-500 ${className}`}>
      匯率：
      <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer" className={linkClass} translate="no">
        Rates By Exchange Rate API
      </a>
    </p>
  );
}
