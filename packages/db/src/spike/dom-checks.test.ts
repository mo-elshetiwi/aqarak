import { expect, it, vi } from "vitest";
import type { DataApiExecutor } from "../data-api.ts";
import { runCheck, sqlState } from "./dom-checks.ts";

function executor(failureSql?: string): DataApiExecutor {
  return {
    begin: vi.fn().mockResolvedValue("synthetic-transaction"),
    execute: vi.fn().mockImplementation((sql: string) => {
      if (sql === failureSql)
        throw new Error("Synthetic rejection; SQLState: AQ020");
      return Promise.resolve({ rows: [], numberOfRecordsUpdated: 0 });
    }),
    commit: vi.fn(),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
}
it("extracts the service SQLSTATE without retaining the error content", () => {
  expect(sqlState(new Error("private content; SQLState: AQ010"))).toBe("AQ010");
  expect(sqlState(new Error("SQLSTATE: 23514"))).toBe("23514");
  expect(sqlState(new Error("transport failure"))).toBe("unknown");
});
it("rolls back an expected database rejection and never commits fixtures", async () => {
  const db = executor("violate");
  const result = await runCheck(db, "fixture", {
    name: "synthetic",
    expected: "AQ020",
    sql: "violate",
  });
  expect(result).toMatchObject({
    actual: "AQ020",
    passed: true,
    rolledBack: true,
  });
  expect(db.rollback).toHaveBeenCalledWith("synthetic-transaction");
  expect(db.commit).not.toHaveBeenCalled();
});
it("fails when an expected invariant accepts the write and still rolls back", async () => {
  const db = executor();
  const result = await runCheck(db, "fixture", {
    name: "synthetic",
    expected: "23514",
    sql: "accepted",
  });
  expect(result).toMatchObject({
    actual: "success",
    passed: false,
    rolledBack: true,
  });
  expect(db.rollback).toHaveBeenCalledOnce();
});
it("does not mistake fixture failure for the expected invariant rejection", async () => {
  const db = executor("fixture");
  const result = await runCheck(db, "fixture", {
    name: "synthetic",
    expected: "AQ020",
    sql: "violate",
  });
  expect(result).toMatchObject({
    actual: "setup_failed:AQ020",
    passed: false,
    rolledBack: true,
  });
  expect(db.rollback).toHaveBeenCalledOnce();
});
it("propagates rollback failure instead of claiming that cleanup succeeded", async () => {
  const db = executor();
  db.rollback = vi.fn().mockRejectedValue(new Error("Rollback failed"));
  await expect(
    runCheck(db, "fixture", {
      name: "synthetic",
      expected: "success",
      sql: "accepted",
    }),
  ).rejects.toThrow("Rollback failed");
});
