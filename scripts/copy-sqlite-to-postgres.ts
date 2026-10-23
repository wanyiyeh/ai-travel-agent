/**
 * Copies the data of an old SQLite database (prisma/dev.db, prisma/mock.db)
 * into the Postgres database in DATABASE_URL (#208, ADR-0007). Every model
 * in the current schema is copied, parents before children; tables and
 * columns the schema no longer has (#206) are left behind. SQLite stores
 * dates as milliseconds and booleans as 0/1; they're converted. The SQLite
 * file is only read.
 *
 * Rows already in Postgres (same primary key) are kept, so it's safe to run
 * again. Without --yes it only prints what it would copy.
 *
 *   npm run copy-sqlite-to-postgres -- prisma/dev.db                    # dry run into DATABASE_URL (.env)
 *   npm run copy-sqlite-to-postgres -- prisma/dev.db --yes
 *   DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock" npm run copy-sqlite-to-postgres -- prisma/mock.db --yes
 * Makes no Google/OpenAI calls.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import { DatabaseSync } from "node:sqlite";

if (existsSync(".env")) process.loadEnvFile(".env");

const CHUNK_SIZE = 500;

type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Field = Model["fields"][number];
type Row = Record<string, unknown>;

/** Models with every model they reference (through a foreign key they hold) first. */
function inInsertOrder(models: readonly Model[]): Model[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const ordered: Model[] = [];
  const visit = (model: Model, path: Set<string>) => {
    if (ordered.includes(model) || path.has(model.name)) return;
    path.add(model.name);
    for (const field of model.fields) {
      if (field.kind === "object" && field.relationFromFields?.length) {
        const parent = byName.get(field.type);
        if (parent && parent !== model) visit(parent, path);
      }
    }
    ordered.push(model);
  };
  for (const model of models) visit(model, new Set());
  return ordered;
}

function convert(value: unknown, field: Field): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case "DateTime":
      return new Date(typeof value === "string" && !/^\d+$/.test(value) ? value : Number(value));
    case "Boolean":
      return Boolean(Number(value));
    case "Int":
    case "Float":
      return Number(value);
    default:
      return value;
  }
}

function delegateOf(prisma: PrismaClient, model: Model) {
  const name = model.name[0].toLowerCase() + model.name.slice(1);
  return (prisma as unknown as Record<string, { count(): Promise<number>; createMany(args: { data: Row[]; skipDuplicates: boolean }): Promise<{ count: number }> }>)[name];
}

async function main() {
  const sourcePath = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const confirmed = process.argv.includes("--yes");
  if (!sourcePath || !existsSync(sourcePath)) {
    console.error("Usage: npm run copy-sqlite-to-postgres -- <path to .db> [--yes]");
    process.exit(1);
  }
  const target = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(target)) {
    console.error("DATABASE_URL must be a Postgres URL.");
    process.exit(1);
  }

  const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
  const prisma = new PrismaClient();
  const sqliteTables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name)),
  );
  console.log(`${confirmed ? "Copying" : "Dry run"}: ${sourcePath} -> ${target.replace(/\/\/[^@]*@/, "//***@")}`);

  try {
    for (const model of inInsertOrder(Prisma.dmmf.datamodel.models)) {
      const table = model.dbName ?? model.name;
      const delegate = delegateOf(prisma, model);
      if (!sqliteTables.has(table)) {
        console.log(`  ${model.name}: not in the SQLite file, skipped`);
        continue;
      }
      const columns = new Set(sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => String(c.name)));
      const scalars = model.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      const data = rows.map((row) => {
        const out: Row = {};
        for (const field of scalars) {
          const column = field.dbName ?? field.name;
          if (columns.has(column)) out[field.name] = convert(row[column], field);
        }
        return out;
      });
      const before = await delegate.count();
      if (!confirmed) {
        console.log(`  ${model.name}: ${data.length} row(s) in SQLite, ${before} already in Postgres`);
        continue;
      }
      let copied = 0;
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        copied += (await delegate.createMany({ data: data.slice(i, i + CHUNK_SIZE), skipDuplicates: true })).count;
      }
      console.log(`  ${model.name}: ${copied} copied, ${data.length - copied} already there (now ${await delegate.count()} in Postgres)`);
    }
    if (!confirmed) console.log("Nothing written. Re-run with --yes to copy.");
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
