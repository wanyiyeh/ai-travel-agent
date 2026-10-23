// `npm run dev:mock` — run the dev server with every Google Places / Routes
// call faked (MOCK_PLACES=1, see src/lib/mockPlaces.ts) against a separate
// travel_mock database (docker-compose.yml), so clicking through UI flows
// costs nothing on Google.
// OpenAI calls are still real. Explicit process env wins over .env / .env.local
// for both Prisma and Next.js, so this doesn't touch your normal setup.
//
// `npm run dev:free` (--mock-ai) also sets MOCK_AI=1 (src/lib/mockAi.ts), so
// nothing at all is billed. Both kinds of fake data stay in travel_mock.
import { spawnSync, spawn } from "node:child_process";

const mockAi = process.argv.includes("--mock-ai");
// MOCK_DATABASE_URL overrides the default local Docker database.
const MOCK_DATABASE_URL = process.env.MOCK_DATABASE_URL ?? "postgresql://travel:travel@localhost:5432/travel_mock";
const env = { ...process.env, MOCK_PLACES: "1", DATABASE_URL: MOCK_DATABASE_URL, ...(mockAi ? { MOCK_AI: "1" } : {}) };

// Bring travel_mock up to the latest migration (no-op when already there).
const push = spawnSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit", shell: true });
if (push.status !== 0) process.exit(push.status ?? 1);

// Extra args pass through to next dev, e.g. `npm run dev:mock -- -p 3001`.
const nextArgs = process.argv.slice(2).filter((arg) => arg !== "--mock-ai");
const dev = spawn("npx", ["next", "dev", ...nextArgs], { env, stdio: "inherit", shell: true });
dev.on("exit", (code) => process.exit(code ?? 0));
