import { signOut } from "@/auth";
import { getActor } from "@/lib/auth/actor";
import DeleteAccountForm from "@/components/DeleteAccountForm";

// Reads the session per request.
export const dynamic = "force-dynamic";

// Where a Google account lists the apps it has signed in to.
const GOOGLE_CONNECTIONS_URL = "https://myaccount.google.com/connections";

async function signOutHome() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function AccountPage() {
  const actor = await getActor();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">帳號</h1>
        {actor?.kind !== "user" ? (
          <p className="mt-4 text-zinc-500 dark:text-zinc-400">請先用右上角的「用 Google 登入」。</p>
        ) : (
          <>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">{actor.email}</p>

            <section className="mt-10 rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-zinc-900 p-6">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">刪除帳號</h2>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">刪除後立即生效，無法復原。會一起刪除：</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400 space-y-1">
                <li>帳號資料（email、名字）</li>
                <li>所有行程，以及垃圾桶與候選紀錄</li>
                <li>使用紀錄（用來計算額度）</li>
              </ul>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                這個網站沒有保存 Google 的授權。若也想移除登入授權，請到
                <a href={GOOGLE_CONNECTIONS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 mx-1">
                  Google 帳戶的第三方連結
                </a>
                自行移除。
              </p>
              <div className="mt-6">
                <DeleteAccountForm email={actor.email} onDeleted={signOutHome} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
