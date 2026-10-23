// Minimal types for Node's built-in SQLite (Node 22.13+), used only by
// scripts/copy-sqlite-to-postgres.ts; @types/node 20 doesn't ship them.
declare module "node:sqlite" {
  interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
