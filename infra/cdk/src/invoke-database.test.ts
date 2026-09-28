import { expect, it } from "vitest";
import { migrationFunctionName, migrationSummary } from "./invoke-database";

it("selects the development function from deployment outputs", () => {
  expect(
    migrationFunctionName({
      "Dev-DatabaseOpsStack": {
        MigrateFunctionName:
          "Dev-DatabaseOpsStack-MigrateDatabaseFunction-test",
      },
    }),
  ).toBe("Dev-DatabaseOpsStack-MigrateDatabaseFunction-test");
});
it.each([
  {},
  { one: { MigrateFunctionName: "Prod-DatabaseOpsStack-function" } },
  {
    one: { MigrateFunctionName: "Dev-DatabaseOpsStack-one" },
    two: { MigrateFunctionName: "Dev-DatabaseOpsStack-two" },
  },
])("rejects missing, production or ambiguous functions", (outputs) => {
  expect(() => migrationFunctionName(outputs)).toThrow();
});
const summary = {
  action: "migrate",
  roles: ["aqarak_app", "aqarak_pipeline", "aqarak_scheduler"],
  migrations: { applied: [], skipped: ["0001_foundation.sql"] },
};
it("returns a validated migration summary including no-op runs", () => {
  expect(migrationSummary({ StatusCode: 200 }, summary)).toEqual(summary);
});
it.each([
  { StatusCode: 200, FunctionError: "Unhandled" },
  { StatusCode: 202 },
  {},
])("rejects failed Lambda invocations", (metadata) => {
  expect(() => migrationSummary(metadata, summary)).toThrow();
});
it("rejects unexpected response content", () => {
  expect(() =>
    migrationSummary({ StatusCode: 200 }, { ...summary, unexpected: "value" }),
  ).toThrow();
});
