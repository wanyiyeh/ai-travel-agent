"use client";

import { signIn } from "next-auth/react";

// Shown on a guest's own itinerary: it's deleted when it expires unless they
// sign in, which moves it to their account (plan/access-control.md §7).
// Hours left come from the API, so rendering never reads the clock.
export default function GuestNotice({ expiresInHours }: { expiresInHours: number }) {
  const remaining = expiresInHours >= 24 ? `${Math.ceil(expiresInHours / 24)} 天` : `${expiresInHours} 小時`;

  return (
    <div data-print-hidden className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <span>
        你目前是訪客，這個行程會在 <strong>{remaining}</strong>後自動刪除。登入即可永久保存，並下載 PDF。
      </span>
      <button
        type="button"
        onClick={() => signIn("google", { redirectTo: window.location.pathname })}
        className="rounded-md bg-amber-900 px-3 py-1.5 font-medium text-white hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
      >
        用 Google 登入並保存
      </button>
    </div>
  );
}
