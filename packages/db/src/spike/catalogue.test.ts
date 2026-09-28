import { expect, it, vi } from "vitest";
import { fakeExecutor } from "../test-helpers.ts";
import {
  APPLICATION_SCHEMAS,
  RUNTIME_ROLES,
  TABLES_SQL,
  ROLES_SQL,
  FORBIDDEN_PRIVILEGES_SQL,
  inspectCatalogue,
  validateCatalogue,
  type CatalogueRole,
  type CatalogueTable,
} from "./catalogue.ts";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
function fixture(): { tables: CatalogueTable[]; roles: CatalogueRole[] } {
  return {
    tables: APPLICATION_SCHEMAS.map((schema) => ({
      name: schema === "ops" ? "ops.idempotency_key" : `${schema}.example`,
      schema,
      relrowsecurity: true,
      relforcerowsecurity: true,
      hasCompanyId: true,
      policies:
        schema === "ops"
          ? [
              {
                name: "idempotency_housekeeping_delete",
                command: "DELETE",
                roles: ["aqarak_scheduler"],
                using: "(created_at < (now() - '7 days'::interval))",
                withCheck: null,
                permissive: true,
                appliesToScheduler: true,
              },
            ]
          : [],
      triggers: [
        {
          name: "a_stamp_update",
          function: "ops.stamp_update",
          enabled: "O",
          definition: "stamp",
        },
        {
          name: "capture_version",
          function: "audit.capture_entity_version",
          enabled: "O",
          definition: "capture",
        },
      ],
      privileges: { aqarak_scheduler: { DELETE: schema === "ops" } },
    })),
    roles: RUNTIME_ROLES.map((name) => ({
      name,
      rolsuper: false,
      rolbypassrls: false,
    })),
  };
}
it("accepts forced company isolation and the documented housekeeping exception", () => {
  const { tables, roles } = fixture();
  expect(
    validateCatalogue(tables, roles, []).every((check) => check.passed),
  ).toBe(true);
});
it.each(["relrowsecurity", "relforcerowsecurity"] as const)(
  "rejects company tables without %s",
  (flag) => {
    const { tables, roles } = fixture();
    required(tables[0])[flag] = false;
    expect(
      validateCatalogue(tables, roles, []).find((check) => !check.passed)
        ?.violations,
    ).toEqual(["core.example"]);
  },
);
it.each(["rolsuper", "rolbypassrls", "missing"] as const)(
  "rejects an unsafe or absent runtime role: %s",
  (flag) => {
    const { tables, roles } = fixture();
    if (flag === "missing") roles.shift();
    else required(roles[0])[flag] = true;
    expect(
      validateCatalogue(tables, roles, []).find((check) => !check.passed)
        ?.violations,
    ).toEqual(["aqarak_app"]);
  },
);
it.each(["TRUNCATE", "REFERENCES", "DELETE"])(
  "rejects effective %s outside the exception, including another schema",
  (privilege) => {
    const { tables, roles } = fixture();
    const result = validateCatalogue(tables, roles, [
      { name: "public.extra", role: "aqarak_pipeline", privilege },
    ]);
    expect(result.find((check) => !check.passed)?.violations).toEqual([
      `aqarak_pipeline ${privilege} public.extra`,
    ]);
  },
);
it.each([
  "broad predicate",
  "additional policy",
  "ALL command",
  "public role",
  "missing grant",
  "missing policy",
])("rejects a changed housekeeping boundary: %s", (change) => {
  const { tables, roles } = fixture();
  const table = required(
    tables.find((row) => row.name === "ops.idempotency_key"),
  );
  const policy = required(table.policies[0]);
  if (change === "broad predicate") policy.using = "created_at < now()";
  if (change === "additional policy")
    table.policies.push({ ...policy, name: "bypass", using: "true" });
  if (change === "ALL command") policy.command = "ALL";
  if (change === "public role") policy.roles = ["public"];
  if (change === "missing grant")
    required(table.privileges.aqarak_scheduler).DELETE = false;
  if (change === "missing policy") table.policies = [];
  expect(
    validateCatalogue(tables, roles, []).find((check) => !check.passed)?.name,
  ).toBe("scheduler DELETE is restricted to the seven-day housekeeping policy");
});
it("rejects an incomplete schema inventory", () => {
  const { tables, roles } = fixture();
  tables.shift();
  expect(
    validateCatalogue(tables, roles, []).find((check) => !check.passed)
      ?.violations,
  ).toEqual(["core"]);
});
it.each([false, true])(
  "reads a consistent read-only snapshot and reports both trigger categories (JSON text: %s)",
  async (asText) => {
    const { tables, roles } = fixture();
    const executor = fakeExecutor();
    vi.mocked(executor.execute).mockImplementation((sql) =>
      Promise.resolve({
        rows:
          sql === TABLES_SQL
            ? tables.map((entry) => ({
                entry: asText ? JSON.stringify(entry) : entry,
              }))
            : sql === ROLES_SQL
              ? roles.map((role) => ({ ...role }))
              : [],
        numberOfRecordsUpdated: 0,
      }),
    );
    const result = await inspectCatalogue(executor);
    expect(result.passed).toBe(true);
    expect(result.tables[0]?.versionTriggers[0]?.name).toBe("a_stamp_update");
    expect(result.tables[0]?.entityVersionTriggers[0]?.name).toBe(
      "capture_version",
    );
    expect(executor.execute).toHaveBeenNthCalledWith(
      1,
      "set transaction isolation level repeatable read read only",
      [],
      "tx-1",
    );
    expect(executor.execute).toHaveBeenCalledWith(
      FORBIDDEN_PRIVILEGES_SQL,
      [],
      "tx-1",
    );
    expect(executor.rollback).toHaveBeenCalledWith("tx-1");
    expect(executor.commit).not.toHaveBeenCalled();
  },
);
it("closes the read-only transaction if a catalogue query fails", async () => {
  const executor = fakeExecutor();
  vi.mocked(executor.execute).mockRejectedValue(new Error("Query failed"));
  await expect(inspectCatalogue(executor)).rejects.toThrow("Query failed");
  expect(executor.rollback).toHaveBeenCalledWith("tx-1");
});
