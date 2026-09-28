import { randomUUID } from "node:crypto";
import type { DataApiExecutor } from "../data-api.ts";
import { CONTEXT_SQL } from "../company-tx.ts";

export interface Check {
  name: string;
  expected: string;
  setup?: string;
  sql: string;
}
export interface Evidence {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  rolledBack: boolean;
  values?: string[];
}
async function prepare(
  executor: DataApiExecutor,
  fixture: string,
  id: string,
): Promise<void> {
  await executor.execute(
    CONTEXT_SQL,
    [
      { name: "company_id", value: randomUUID() },
      { name: "account_id", value: "" },
    ],
    id,
  );
  await executor.execute(fixture, [], id);
}
export function sqlState(error: unknown): string {
  return (
    /SQLSTATE:\s*([0-9A-Z]{5})/iu.exec(
      error instanceof Error ? error.message : "",
    )?.[1] ?? "unknown"
  );
}
export async function runCheck(
  executor: DataApiExecutor,
  fixture: string,
  check: Check,
): Promise<Evidence> {
  const id = await executor.begin();
  const result: Evidence = {
    name: check.name,
    expected: check.expected,
    actual: "not_run",
    passed: false,
    rolledBack: false,
  };
  try {
    await prepare(executor, fixture, id);
    if (check.setup) await executor.execute(check.setup, [], id);
    try {
      await executor.execute(check.sql, [], id);
      result.actual = "success";
    } catch (error) {
      result.actual = sqlState(error);
    }
    result.passed = result.actual === result.expected;
  } catch (error) {
    result.actual = `setup_failed:${sqlState(error)}`;
  } finally {
    await executor.rollback(id);
    result.rolledBack = true;
  }
  return result;
}
export async function runNumbers(
  executor: DataApiExecutor,
  fixture: string,
): Promise<Evidence> {
  const id = await executor.begin();
  const result: Evidence = {
    name: "five number rollbacks leave no gap",
    expected: "1,1,1,1,1,1,2",
    actual: "not_run",
    passed: false,
    rolledBack: false,
    values: [],
  };
  try {
    await prepare(executor, fixture, id);
    const values: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      await executor.execute("savepoint forced_rollback", [], id);
      const next = await executor.execute(
        "select ops.next_number('RCPT')::text as n",
        [],
        id,
      );
      values.push(String(next.rows[0]?.n));
      await executor.execute("rollback to savepoint forced_rollback", [], id);
      await executor.execute("release savepoint forced_rollback", [], id);
    }
    for (let step = 0; step < 2; step++) {
      const next = await executor.execute(
        "select ops.next_number('RCPT')::text as n",
        [],
        id,
      );
      values.push(String(next.rows[0]?.n));
    }
    result.values = values;
    result.actual = values.join(",");
    result.passed = result.actual === result.expected;
  } catch (error) {
    result.actual = sqlState(error);
  } finally {
    await executor.rollback(id);
    result.rolledBack = true;
  }
  return result;
}
