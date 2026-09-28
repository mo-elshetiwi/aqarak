import { createHash } from "node:crypto";
import { vi } from "vitest";
import type {
  DataApiExecutor,
  ExecuteResult,
  Parameter,
  Row,
} from "./data-api.ts";
import type { Migration } from "./migrate.ts";

export function migration(name: string, sql: string): Migration {
  return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
}
export function fakeExecutor(ledger: Row[] = []): DataApiExecutor & {
  statements: {
    sql: string;
    params: readonly Parameter[];
    transactionId: string | undefined;
  }[];
} {
  const statements: {
    sql: string;
    params: readonly Parameter[];
    transactionId: string | undefined;
  }[] = [];
  let next = 0;
  return {
    statements,
    begin: vi.fn(() => Promise.resolve(`tx-${String(++next)}`)),
    commit: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
    execute: vi.fn(
      (
        sql: string,
        params: readonly Parameter[] = [],
        transactionId?: string,
      ): Promise<ExecuteResult> => {
        statements.push({ sql, params, transactionId });
        let rows: Row[] = [];
        if (sql.includes("pg_try_advisory")) rows = [{ locked: true }];
        if (sql.includes("to_regclass"))
          rows = [{ ledger: "ops.schema_migration" }];
        if (sql.startsWith("select name, sha256")) rows = ledger;
        return Promise.resolve({ rows, numberOfRecordsUpdated: 0 });
      },
    ),
  };
}
