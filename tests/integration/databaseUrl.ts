// The integration suite's database: travel_test in the local Docker Postgres
// (docker-compose.yml) by default; CI's Postgres service listens at the same
// address. TEST_DATABASE_URL overrides it. Never the dev database: the
// global setup wipes it.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://travel:travel@localhost:5432/travel_test";
