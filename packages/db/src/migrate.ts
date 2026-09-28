import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DataApiExecutor, Row } from "./data-api.ts";

export interface Migration {
  name: string;
  sha256: string;
  sql: string;
}
export interface MigrationSummary {
  applied: string[];
  skipped: string[];
}
export class MigrationStatementError extends Error {
  readonly migration: string;
  readonly sqlState: string;

  constructor(name: string, error: unknown) {
    const migration = /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)
      ? name
      : "unknown migration";
    const message = error instanceof Error ? error.message : "";
    const sqlState =
      /\bSQLSTATE:\s*([0-9A-Z]{5})\b/u.exec(message)?.[1] ?? "unknown";
    super(`Migration ${migration} failed (SQLSTATE: ${sqlState})`);
    this.name = "MigrationStatementError";
    this.migration = migration;
    this.sqlState = sqlState;
  }
}
export type MigrationLog = (entry: {
  name: string;
  status: "applied" | "skipped";
}) => void;
export function splitStatements(sql: string): string[] {
  return sql
    .split(/^--> statement-breakpoint\s*$/mu)
    .map((part) => part.trim())
    .filter(Boolean);
}
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const names = (await readdir(dir))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(dir, name), "utf8");
      return {
        name,
        sql,
        sha256: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}
async function transaction<T>(
  executor: DataApiExecutor,
  fn: (id: string) => Promise<T>,
): Promise<T> {
  const id = await executor.begin();
  try {
    const value = await fn(id);
    await executor.commit(id);
    return value;
  } catch (error) {
    await executor.rollback(id).catch(() => undefined);
    throw error;
  }
}
function validateHashes(migrations: readonly Migration[], rows: Row[]): void {
  for (const row of rows) {
    const migration = migrations.find((file) => file.name === row.name);
    if (!migration || migration.sha256 !== row.sha256)
      throw new Error(
        `Applied migration changed or missing: ${String(row.name)}`,
      );
  }
}
async function readLedger(
  executor: DataApiExecutor,
  id: string,
): Promise<Row[]> {
  return (
    await executor.execute(
      "select name, sha256 from ops.schema_migration order by name",
      [],
      id,
    )
  ).rows;
}
async function lock(executor: DataApiExecutor, id: string): Promise<void> {
  const result = await executor.execute(
    "select pg_try_advisory_xact_lock(110, 2) as locked",
    [],
    id,
  );
  if (result.rows[0]?.locked !== true)
    throw new Error("Another migration run is active");
}
export async function runMigrations(
  executor: DataApiExecutor,
  migrations: readonly Migration[],
  log: MigrationLog = () => undefined,
): Promise<MigrationSummary> {
  const ordered = [...migrations].sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
  if (new Set(ordered.map((file) => file.name)).size !== ordered.length)
    throw new Error("Duplicate migration names");
  for (const file of ordered) {
    if (createHash("sha256").update(file.sql).digest("hex") !== file.sha256)
      throw new Error(`Migration hash is invalid: ${file.name}`);
  }
  await transaction(executor, async (id) => {
    await lock(executor, id);
    const exists = await executor.execute(
      "select to_regclass('ops.schema_migration')::text as ledger",
      [],
      id,
    );
    if (exists.rows[0]?.ledger) {
      validateHashes(ordered, await readLedger(executor, id));
    } else {
      await executor.execute(
        "create schema if not exists ops authorization postgres",
        [],
        id,
      );
      await executor.execute(
        "create table ops.schema_migration(name text primary key, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), applied_at timestamptz not null default now())",
        [],
        id,
      );
      await executor.execute(
        "alter table ops.schema_migration owner to postgres",
        [],
        id,
      );
      await executor.execute(
        "revoke all on ops.schema_migration from public",
        [],
        id,
      );
    }
  });
  const summary: MigrationSummary = { applied: [], skipped: [] };
  for (const migration of ordered) {
    const status = await transaction(executor, async (id) => {
      await lock(executor, id);
      const ledger = await readLedger(executor, id);
      validateHashes(ordered, ledger);
      if (ledger.some((row) => row.name === migration.name))
        return "skipped" as const;
      for (const sql of splitStatements(migration.sql)) {
        try {
          await executor.execute(sql, [], id);
        } catch (error) {
          throw new MigrationStatementError(migration.name, error);
        }
      }
      await executor.execute(
        "insert into ops.schema_migration(name, sha256) values (:name, :sha256)",
        [
          { name: "name", value: migration.name },
          { name: "sha256", value: migration.sha256 },
        ],
        id,
      );
      return "applied" as const;
    });
    summary[status].push(migration.name);
    log({ name: migration.name, status });
  }
  return summary;
}
