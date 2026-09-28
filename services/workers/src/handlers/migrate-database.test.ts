import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DataApiExecutor, ExecuteResult } from "@aqarak/db/data-api";
import { createHandler, type HandlerDependencies } from "./migrate-database.ts";

function dependencies(): HandlerDependencies & { calls: string[] } {
  const calls: string[] = [];
  const executor: DataApiExecutor = {
    begin: () => Promise.resolve("synthetic-tx"),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
    execute: (sql): Promise<ExecuteResult> => {
      // Retain only operation labels, never password-bearing statements.
      calls.push(
        sql.startsWith("create role")
          ? "create-role"
          : sql.startsWith("alter role")
            ? "restrict-role"
            : sql,
      );
      return Promise.resolve({
        rows: sql.includes("pg_try_advisory")
          ? [{ locked: true }]
          : sql.includes("to_regclass")
            ? [{ ledger: "ops.schema_migration" }]
            : [],
        numberOfRecordsUpdated: 0,
      });
    },
  };
  return {
    calls,
    environment: {
      DATABASE_CLUSTER_ARN: "synthetic-cluster",
      DATABASE_NAME: "synthetic",
      MASTER_SECRET_ARN: "master",
      APP_SECRET_ARN: "aqarak_app",
      PIPELINE_SECRET_ARN: "aqarak_pipeline",
      SCHEDULER_SECRET_ARN: "aqarak_scheduler",
      MIGRATIONS_DIR: "/synthetic/migrations",
      AWS_REGION: "us-east-1",
    },
    executor: vi.fn(() => executor),
    readSecret: vi.fn((arn: string) =>
      Promise.resolve(
        JSON.stringify({ username: arn, password: "synthetic-credential" }),
      ),
    ),
    load: vi.fn(() =>
      Promise.resolve([
        {
          name: "0001_synthetic.sql",
          sql: "select 'migration';",
          sha256: createHash("sha256")
            .update("select 'migration';")
            .digest("hex"),
        },
      ]),
    ),
    log: vi.fn(),
    logError: vi.fn(),
  };
}
it("AC-7 bootstraps all roles before migration and returns no credential material", async () => {
  const deps = dependencies();
  const summary = await createHandler(deps)({ action: "migrate" });
  expect(deps.calls.filter((call) => call === "create-role")).toHaveLength(3);
  expect(deps.calls.lastIndexOf("restrict-role")).toBeLessThan(
    deps.calls.indexOf("select 'migration';"),
  );
  expect(summary).toEqual({
    action: "migrate",
    roles: ["aqarak_app", "aqarak_pipeline", "aqarak_scheduler"],
    migrations: { applied: ["0001_synthetic.sql"], skipped: [] },
  });
  expect(JSON.stringify(summary)).not.toMatch(
    /synthetic-credential|SCRAM|password/u,
  );
  expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toMatch(
    /synthetic-credential|SCRAM|password/u,
  );
});
it("defaults to migrate and loads the configured migration directory", async () => {
  const deps = dependencies();
  await createHandler(deps)({});
  expect(deps.load).toHaveBeenCalledWith("/synthetic/migrations");
  expect(deps.executor).toHaveBeenCalledWith("master");
});
it("rejects unsupported actions before credentials or SQL", async () => {
  const deps = dependencies();
  await expect(createHandler(deps)({ action: "invalid" })).rejects.toThrow(
    "Unsupported",
  );
  expect(deps.executor).not.toHaveBeenCalled();
  expect(deps.readSecret).not.toHaveBeenCalled();
});
it("does not start migrations after role bootstrap fails", async () => {
  const deps = dependencies();
  vi.mocked(deps.readSecret).mockRejectedValue(
    new Error("Synthetic unavailable secret: synthetic-credential"),
  );
  await expect(createHandler(deps)({ action: "migrate" })).rejects.toThrow(
    "Database role bootstrap failed",
  );
  expect(deps.load).not.toHaveBeenCalled();
  expect(deps.log).not.toHaveBeenCalled();
  expect(deps.logError).not.toHaveBeenCalled();
});

it("logs and throws only the migration file and SQLSTATE on statement failure", async () => {
  const deps = dependencies();
  const executor = deps.executor("master");
  const original = executor.execute;
  executor.execute = (sql, params, id) => {
    if (sql === "select 'migration';") {
      return Promise.reject(
        new Error(
          "ERROR: synthetic-value in select 'migration'; SQLSTATE: 42P07",
        ),
      );
    }
    return original(sql, params, id);
  };
  const failure: unknown = await createHandler(deps)({
    action: "migrate",
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error))
    throw new Error("Expected migration failure");
  expect(failure.message).toBe(
    "Migration 0001_synthetic.sql failed (SQLSTATE: 42P07)",
  );
  expect(failure.cause).toBeUndefined();
  expect(deps.logError).toHaveBeenCalledExactlyOnceWith(failure.message);
  expect(
    JSON.stringify({ failure, logs: vi.mocked(deps.logError).mock.calls }),
  ).not.toMatch(/synthetic-value|select |synthetic-credential|SCRAM/u);
  expect(deps.log).not.toHaveBeenCalled();
});
