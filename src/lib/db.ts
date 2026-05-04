import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof makePrisma> | undefined;
};

// SQLite stores Json fields as String — this extension auto-serializes on write
// and auto-parses on read so all other code stays unchanged.
function makePrisma() {
  const client = new PrismaClient();

  return client.$extends({
    result: {
      itinerary: {
        days: {
          needs: { days: true },
          compute(row) {
            return typeof row.days === "string" ? JSON.parse(row.days) : row.days;
          },
        },
        config: {
          needs: { config: true },
          compute(row) {
            return typeof row.config === "string" ? JSON.parse(row.config) : row.config;
          },
        },
      },
    },
    query: {
      itinerary: {
        async create({ args, query }) {
          if (args.data.days && typeof args.data.days !== "string") {
            args.data.days = JSON.stringify(args.data.days) as never;
          }
          if (args.data.config && typeof args.data.config !== "string") {
            args.data.config = JSON.stringify(args.data.config) as never;
          }
          return query(args);
        },
        async update({ args, query }) {
          if (args.data.days && typeof args.data.days !== "string") {
            args.data.days = JSON.stringify(args.data.days) as never;
          }
          if (args.data.config && typeof args.data.config !== "string") {
            args.data.config = JSON.stringify(args.data.config) as never;
          }
          return query(args);
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? makePrisma();

/** Cast any value to the String type Prisma expects for SQLite Json-as-String fields. */
export function j(val: unknown): string {
  return (typeof val === "string" ? val : JSON.stringify(val)) as string;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
