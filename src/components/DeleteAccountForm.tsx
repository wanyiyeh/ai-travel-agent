"use client";

import { useState, useTransition } from "react";
import { confirmsEmail } from "@/lib/auth/confirmsEmail";

// Typing the account's email is what unlocks the button: deleting is
// immediate and can't be undone. Once the server confirms, `onDeleted`
// (a server action) signs the browser out and goes home.
export default function DeleteAccountForm({ email, onDeleted }: { email: string; onDeleted: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = confirmsEmail(typed, email);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/v1/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed }),
      }).catch(() => null);
      if (!res || res.status !== 204) {
        setError("刪除失敗，請稍後再試。");
        return;
      }
      await onDeleted();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm text-zinc-700 dark:text-zinc-300">
        請輸入你的 email（{email}）確認刪除
        <input
          type="email"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-zinc-900 dark:text-zinc-100"
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={!matches || pending}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "刪除中…" : "永久刪除帳號"}
      </button>
    </form>
  );
}
