import { PrismaClient } from "@prisma/client";
import { assertMockPlacesDatabase } from "@/lib/mockPlaces";
import {
  stripCandidates,
  stripDay,
  stripDays,
  stripJsonField,
  stripStop,
} from "@/lib/placeStorage";

// Refuse to start with MOCK_PLACES pointed at a real DB — fake places would be
// cached into it and keep being served after mock mode is turned off.
assertMockPlacesDatabase();

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
          if (args.data.days) args.data.days = stripJsonField(args.data.days, stripDays) as never;
          if (args.data.days && typeof args.data.days !== "string") {
            args.data.days = JSON.stringify(args.data.days) as never;
          }
          if (args.data.config && typeof args.data.config !== "string") {
            args.data.config = JSON.stringify(args.data.config) as never;
          }
          return query(args);
        },
        async update({ args, query }) {
          if (args.data.days) args.data.days = stripJsonField(args.data.days, stripDays) as never;
          if (args.data.days && typeof args.data.days !== "string") {
            args.data.days = JSON.stringify(args.data.days) as never;
          }
          if (args.data.config && typeof args.data.config !== "string") {
            args.data.config = JSON.stringify(args.data.config) as never;
          }
          return query(args);
        },
      },
      // Trash and candidate history keep whole stops, days and candidate
      // lists, so they're stripped the same way (ADR-0004, placeStorage.ts).
      deletedStop: {
        async create({ args, query }) {
          args.data.stop = stripJsonField(args.data.stop, stripStop) as string;
          return query(args);
        },
      },
      deletedDay: {
        async create({ args, query }) {
          args.data.day = stripJsonField(args.data.day, stripDay) as string;
          return query(args);
        },
        async createMany({ args, query }) {
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          for (const row of rows) row.day = stripJsonField(row.day, stripDay) as string;
          return query(args);
        },
      },
      accommodationCandidateLog: {
        async create({ args, query }) {
          args.data.candidates = stripJsonField(args.data.candidates, stripCandidates) as string;
          return query(args);
        },
      },
      mealCandidateLog: {
        async create({ args, query }) {
          args.data.candidates = stripJsonField(args.data.candidates, stripCandidates) as string;
          return query(args);
        },
      },
      stopCandidateLog: {
        async create({ args, query }) {
          args.data.candidates = stripJsonField(args.data.candidates, stripCandidates) as string;
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
