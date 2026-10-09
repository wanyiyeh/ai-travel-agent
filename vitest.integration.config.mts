import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate from vitest.config.ts (unit tests) because these hit a real
// SQLite db via Prisma — kept out of `npm test` so the fast unit suite
// stays hermetic and CI can run them independently.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@tests": path.resolve(import.meta.dirname, "./tests"),
    },
  },
  test: {
    environment: "node",
    // Mocks "@/auth"; tests pick the signed-in user with signInAs().
    setupFiles: ["./tests/setup/mockAuth.ts"],
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    env: {
      // Relative sqlite paths resolve against prisma/schema.prisma's
      // directory, not the repo root — this lands at prisma/test.db.
      DATABASE_URL: "file:./test.db",
      MOCK_AI: "1",
      // Signs guest cookies and keys the IP hash in usage quotas.
      AUTH_SECRET: "integration-test-secret",
      // Tests stub fetch; a missing stub must fail, not bill. Prisma loads
      // .env, which never overrides a variable already set.
      GOOGLE_PLACES_API_KEY: "",
      OPENAI_API_KEY: "integration-tests-never-call-openai",
    },
    // Prisma writes to one shared SQLite file — parallel files would race
    // on table state (e.g. one test's cleanup deleting another's fixture).
    fileParallelism: false,
  },
});
