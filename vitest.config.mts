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
  },
});
