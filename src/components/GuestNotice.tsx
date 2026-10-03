"use client";

import { signIn } from "next-auth/react";

// Shown on a guest's own itinerary: it's deleted at expiresAt unless they
// sign in, which moves it to their account (plan/access-control.md §7).
export default function GuestNotice({ expiresAt }: { expiresAt: string }) {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const hoursLeft = Math.max(0, Math.ceil(msLeft / (60 * 60 * 1000)));
  const remaining = hoursLeft >= 24 ? `${Math.ceil(hoursLeft / 24)} 天` : `${hoursLeft} 小時`;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
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
