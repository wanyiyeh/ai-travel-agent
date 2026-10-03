import { auth, signIn, signOut } from "@/auth";

// Thin bar at the top of every page: sign in with Google, or show who's
// signed in with a sign-out button. Server actions, so no client JS.
export default async function AccountBar() {
  const session = await auth();
  const email = session?.user?.email;

  return (
    <div data-print-hidden className="flex items-center justify-end gap-3 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400">
      {email ? (
        <>
          <span className="truncate max-w-[60vw]" title={email}>
            {email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100">
              登出
            </button>
          </form>
        </>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button type="submit" className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100">
            用 Google 登入
          </button>
        </form>
      )}
    </div>
  );
}
