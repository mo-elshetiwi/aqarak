import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  loadMigrations,
  MigrationStatementError,
  runMigrations,
  splitStatements,
} from "./migrate.ts";
import { fakeExecutor, migration } from "./test-helpers.ts";

describe("forward-only migrations", () => {
  it.each([
    [new Error("ERROR: private-value SQLSTATE: AQ004"), "AQ004"],
    [new Error("ERROR: private-value SQLSTATE: 42P07"), "42P07"],
    [new Error("private-value SQLSTATE: 42P070"), "unknown"],
    [new Error("private-value"), "unknown"],
    ["private-value", "unknown"],
  ])(
    "retains only a safe SQLSTATE from a statement failure",
    (cause, state) => {
      const error = new MigrationStatementError("0001_synthetic.sql", cause);
      expect(error.message).toBe(
        `Migration 0001_synthetic.sql failed (SQLSTATE: ${state})`,
      );
      expect(error.cause).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain("private-value");
    },
  );
  it("does not reflect an invalid migration name into diagnostics", () => {
    const error = new MigrationStatementError(
      "private-value\n.sql",
      new Error("private-value"),
    );
    expect(error.message).toBe(
      "Migration unknown migration failed (SQLSTATE: unknown)",
    );
  });
  it("AC-1 preserves function-body semicolons across three breakpoints", () => {
    const body =
      "create function f() returns void language plpgsql as $$ begin perform 1; perform 2; end $$;";
    expect(
      splitStatements(
        `${body}\n--> statement-breakpoint\nselect 1;\n--> statement-breakpoint\nselect 2;\n--> statement-breakpoint\nselect 3;`,
      ),
    ).toEqual([body, "select 1;", "select 2;", "select 3;"]);
  });
  it("AC-2 rejects any changed applied hash before executing migration SQL", async () => {
    const executor = fakeExecutor([
      { name: "0002_changed.sql", sha256: "old" },
    ]);
    await expect(
      runMigrations(executor, [
        migration("0001_new.sql", "select 'new';"),
        migration("0002_changed.sql", "select 'changed';"),
      ]),
    ).rejects.toThrow("0002_changed.sql");
    expect(
      executor.statements.some(
        ({ sql }) =>
          sql.includes("'new'") ||
          sql.includes("'changed'") ||
          sql.startsWith("insert") ||
          sql.startsWith("create"),
      ),
    ).toBe(false);
  });
  it("AC-3 rolls back the failed file and never records it", async () => {
    const executor = fakeExecutor();
    const execute = vi.mocked(executor.execute).getMockImplementation();
    if (!execute) throw new Error("Fake executor implementation is missing");
    vi.spyOn(executor, "execute").mockImplementation((sql, params, id) => {
      if (sql === "select broken;")
        return Promise.reject(
          new Error("ERROR: Synthetic statement failure SQLSTATE: 42601"),
        );
      return execute(sql, params, id);
    });
    await expect(
      runMigrations(executor, [
        migration(
          "0001_failure.sql",
          "select 1;\n--> statement-breakpoint\nselect broken;",
        ),
      ]),
    ).rejects.toThrow("Migration 0001_failure.sql failed (SQLSTATE: 42601)");
    expect(executor.rollback).toHaveBeenCalledWith("tx-2");
    expect(executor.execute).toHaveBeenCalledWith("select 1;", [], "tx-2");
    expect(executor.execute).toHaveBeenCalledWith("select broken;", [], "tx-2");
    expect(executor.commit).not.toHaveBeenCalledWith("tx-2");
    expect(
      executor.statements.some(({ sql }) =>
        sql.startsWith("insert into ops.schema_migration"),
      ),
    ).toBe(false);
  });
  it("skips applied files and commits each new file with its ledger entry", async () => {
    const first = migration("0001_first.sql", "select 1;");
    const second = migration(
      "0002_second.sql",
      "select 2;\n--> statement-breakpoint\nselect 3;",
    );
    const executor = fakeExecutor([{ name: first.name, sha256: first.sha256 }]);
    const result = await runMigrations(executor, [second, first]);
    expect(result).toEqual({ applied: [second.name], skipped: [first.name] });
    const applied = executor.statements.filter(({ sql }) =>
      /select [23];|insert into ops/u.test(sql),
    );
    expect(applied).toHaveLength(3);
    expect(applied.every(({ transactionId }) => transactionId === "tx-3")).toBe(
      true,
    );
  });
  it("loads the foundation and forward migration in lexical order with content hashes", async () => {
    const files = await loadMigrations(
      fileURLToPath(new URL("../migrations", import.meta.url)),
    );
    expect(files.slice(0, 9).map(({ name }) => name)).toEqual([
      "0001_foundation.sql",
      "0002_core_and_documents.sql",
      "0003_linear_canonical_text.sql",
      "0004_align_audit_event_content.sql",
      "0005_parties_and_estate.sql",
      "0006_contracts.sql",
      "0007_operations.sql",
      "0008_money.sql",
      "0009_work_maintenance_and_models.sql",
    ]);
    const names = files.map(({ name }) => name);
    for (const [index, name] of names.entries()) {
      expect(name).toMatch(/^\d{4}_[a-z][a-z0-9_]*\.sql$/u);
      if (index > 0) {
        expect(Number(name.slice(0, 4))).toBeGreaterThan(
          Number(names[index - 1]?.slice(0, 4)),
        );
      }
    }
    expect(files.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(
      true,
    );
  });
  it("refuses concurrent runners before applying SQL", async () => {
    const executor = fakeExecutor();
    vi.mocked(executor.execute).mockResolvedValue({
      rows: [{ locked: false }],
      numberOfRecordsUpdated: 0,
    });
    await expect(
      runMigrations(executor, [migration("0001_first.sql", "select 1;")]),
    ).rejects.toThrow("Another migration run");
    expect(executor.rollback).toHaveBeenCalledWith("tx-1");
  });
});
