import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate from vitest.config.ts (unit tests) because these hit a real
// SQLite db via Prisma — kept out of `npm test` so the fast unit suite
// stays hermetic and CI can run them independently.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    env: {
      // Relative sqlite paths resolve against prisma/schema.prisma's
      // directory, not the repo root — this lands at prisma/test.db.
      DATABASE_URL: "file:./test.db",
      MOCK_AI: "1",
    },
    // Prisma writes to one shared SQLite file — parallel files would race
    // on table state (e.g. one test's cleanup deleting another's fixture).
    fileParallelism: false,
  },
});
