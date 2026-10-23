import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./databaseUrl";

// Runs once before the integration suite: rebuilds the dedicated test
// database from the migrations, so tests never touch the dev database and
// the migrations themselves are exercised.
export default function setup() {
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
