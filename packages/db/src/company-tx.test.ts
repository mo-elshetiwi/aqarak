import { expect, it, vi } from "vitest";
import { CONTEXT_SQL, withCompanyTx, withSystemTx } from "./company-tx.ts";
import { fakeExecutor } from "./test-helpers.ts";

it("sets both local contexts as the first statement and keeps every call in one transaction", async () => {
  const executor = fakeExecutor();
  await withCompanyTx(
    executor,
    { companyId: "synthetic-company", accountId: "synthetic-account" },
    async (tx) => {
      await tx.execute("select 1");
      await tx.execute("select 2");
    },
  );
  expect(executor.statements[0]).toEqual({
    sql: CONTEXT_SQL,
    params: [
      { name: "company_id", value: "synthetic-company" },
      { name: "account_id", value: "synthetic-account" },
    ],
    transactionId: "tx-1",
  });
  expect(
    executor.statements.every(({ transactionId }) => transactionId === "tx-1"),
  ).toBe(true);
  expect(executor.commit).toHaveBeenCalledWith("tx-1");
});
it("clears the account context for a system transaction", async () => {
  const executor = fakeExecutor();
  await withSystemTx(executor, { companyId: "synthetic-company" }, () =>
    Promise.resolve(),
  );
  expect(executor.statements[0]?.params[1]?.value).toBe("");
});
it("rolls back a callback failure and preserves it when rollback also fails", async () => {
  const executor = fakeExecutor();
  vi.mocked(executor.rollback).mockRejectedValue(new Error("Rollback failed"));
  await expect(
    withSystemTx(executor, { companyId: "synthetic-company" }, () =>
      Promise.reject(new Error("Original failure")),
    ),
  ).rejects.toThrow("Original failure");
  expect(executor.commit).not.toHaveBeenCalled();
});
it("rolls back a commit failure and preserves the commit error", async () => {
  const executor = fakeExecutor();
  vi.mocked(executor.commit).mockRejectedValue(new Error("Coverage failure"));
  await expect(
    withSystemTx(executor, { companyId: "synthetic-company" }, () =>
      Promise.resolve(),
    ),
  ).rejects.toThrow("Coverage failure");
  expect(executor.rollback).toHaveBeenCalledWith("tx-1");
});

it("gives both context results unique names for Data API JSON output", () => {
  expect(CONTEXT_SQL).toContain("as company_context");
  expect(CONTEXT_SQL).toContain("as account_context");
});

it("uses distinct result names for Data API JSON conversion", () => {
  const aliases = [
    ...CONTEXT_SQL.matchAll(/set_config\([^)]*\) as (\w+)/gu),
  ].map((match) => match[1]);
  expect(aliases).toHaveLength(2);
  expect(new Set(aliases).size).toBe(2);
});
