// `npm run dev:mock` — run the dev server with every Google Places / Routes
// call faked (MOCK_PLACES=1, see src/lib/mockPlaces.ts) against a separate
// prisma/mock.db, so clicking through UI flows costs nothing on Google.
// OpenAI calls are still real. Explicit process env wins over .env / .env.local
// for both Prisma and Next.js, so this doesn't touch your normal setup.
//
// `npm run dev:free` (--mock-ai) also sets MOCK_AI=1 (src/lib/mockAi.ts), so
// nothing at all is billed. Both kinds of fake data stay in mock.db.
import { spawnSync, spawn } from "node:child_process";

const mockAi = process.argv.includes("--mock-ai");
const env = { ...process.env, MOCK_PLACES: "1", DATABASE_URL: "file:./mock.db", ...(mockAi ? { MOCK_AI: "1" } : {}) };

// Create/sync prisma/mock.db from schema.prisma (no-op when already in sync).
const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], { env, stdio: "inherit", shell: true });
if (push.status !== 0) process.exit(push.status ?? 1);

// Extra args pass through to next dev, e.g. `npm run dev:mock -- -p 3001`.
const nextArgs = process.argv.slice(2).filter((arg) => arg !== "--mock-ai");
const dev = spawn("npx", ["next", "dev", ...nextArgs], { env, stdio: "inherit", shell: true });
dev.on("exit", (code) => process.exit(code ?? 0));
