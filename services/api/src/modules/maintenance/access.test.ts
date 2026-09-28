import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { createAuthenticator } from "./auth";
import { authorise, transaction } from "./access";
import { Denied, Problem } from "./problem";

it("refuses absent authorization before reading runtime configuration", async () => {
  expect(
    await createAuthenticator()(new Request("https://example.invalid")),
  ).toBeNull();
});
it("sets the verified account and company before work and rolls back failures", async () => {
  const account = randomUUID();
  const company = randomUUID();
  const db: DataApiExecutor = {
    begin: vi.fn().mockResolvedValue("synthetic-tx"),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue({ rows: [], numberOfRecordsUpdated: 0 }),
  };
  await expect(
    transaction(
      db,
      { companyId: company, subject: account, channel: "mobile_form" },
      (tx) => {
        expect(tx.accountId).toBe(account);
        return Promise.reject(
          new Problem(409, "STALE_VERSION", "The record has changed."),
        );
      },
    ),
  ).rejects.toThrow("STALE_VERSION");
  expect(db.commit).not.toHaveBeenCalled();
  expect(db.rollback).toHaveBeenCalledOnce();
  expect(db.execute).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("app.account_id"),
    [
      { name: "company", value: company },
      { name: "account", value: account },
    ],
    "synthetic-tx",
  );
});
it.each(["none", "accountant", "owner"])(
  "refuses %s before a command can replay",
  async (role) => {
    const tx = {
      accountId: randomUUID(),
      scope: {
        companyId: randomUUID(),
        subject: randomUUID(),
        channel: "mobile_form" as const,
      },
      execute: vi.fn().mockResolvedValue({
        rows:
          role === "none"
            ? []
            : role === "owner"
              ? [{ kind: "owner", data: { id: randomUUID() } }]
              : [{ kind: "membership", data: { is_accountant: true } }],
        numberOfRecordsUpdated: 0,
      }),
    };
    const error: unknown = await authorise(tx, "write").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Denied);
    if (error instanceof Denied)
      expect(error.body.status).toBe(role === "none" ? 404 : 403);
  },
);
