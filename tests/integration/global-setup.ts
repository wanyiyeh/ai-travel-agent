import { execSync } from "node:child_process";

// Runs once before the integration suite: pushes the current Prisma schema
// onto a dedicated test.db file so tests never touch prisma/dev.db.
export default function setup() {
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "inherit",
  });
}
