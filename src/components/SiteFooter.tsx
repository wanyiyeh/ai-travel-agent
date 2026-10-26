import Link from "next/link";

// Bottom of every page: the privacy page (#261).
export default function SiteFooter() {
  return (
    <footer data-print-hidden className="px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
      <Link href="/privacy" className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100">
        隱私權說明
      </Link>
    </footer>
  );
}
