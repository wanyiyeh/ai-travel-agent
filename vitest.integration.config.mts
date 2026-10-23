import { defineConfig } from "vitest/config";
import path from "node:path";
import { TEST_DATABASE_URL } from "./tests/integration/databaseUrl";

// Separate from vitest.config.ts (unit tests) because these hit a real
// Postgres database via Prisma — kept out of `npm test` so the fast unit suite
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
      // travel_test in the local Docker Postgres (docker-compose.yml), or
      // the CI service; never the dev database.
      DATABASE_URL: TEST_DATABASE_URL,
      MOCK_AI: "1",
      // Signs guest cookies and keys the IP hash in usage quotas.
      AUTH_SECRET: "integration-test-secret",
      // Tests stub fetch; a missing stub must fail, not bill. Prisma loads
      // .env, which never overrides a variable already set.
      GOOGLE_PLACES_API_KEY: "",
      OPENAI_API_KEY: "integration-tests-never-call-openai",
      // Open-Meteo has no key to blank (climate.ts).
      CLIMATE_LOOKUPS: "off",
    },
    // Prisma writes to one shared database — parallel files would race
    // on table state (e.g. one test's cleanup deleting another's fixture).
    fileParallelism: false,
  },
});
