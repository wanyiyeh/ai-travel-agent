import { defineConfig } from "vitest/config";
import path from "node:path";

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
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    // Unit tests never reach a real service. Prisma loads .env into the
    // environment, so without these a test missing a mock used the real
    // Google key and dev.db (a suburb search billed 6 Nearby requests and
    // wrote to the cache). .env never overrides a variable already set:
    // - no Google key: lookups skip themselves (tests stub one when needed);
    // - a fake OpenAI key: openai.ts needs one at import, and it can't bill;
    // - a database that doesn't exist: any query fails to connect;
    // - no weather lookups: Open-Meteo has no key to blank (climate.ts);
    // - in-memory rate limits, generation lock and daily budget, instead of
    //   the Postgres ones (sharedState.ts).
    env: {
      CLIMATE_LOOKUPS: "off",
      SHARED_STATE: "memory",
      GOOGLE_PLACES_API_KEY: "",
      OPENAI_API_KEY: "unit-tests-never-call-openai",
      // Signs guest cookies and hashes client IPs (requestFingerprint.ts).
      AUTH_SECRET: "unit-tests-auth-secret",
      DATABASE_URL: "postgresql://unit-tests-must-not-use-a-database@127.0.0.1:1/none",
    },
  },
});
