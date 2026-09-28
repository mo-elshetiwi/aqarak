import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DataApiExecutor, Parameter, Row } from "@aqarak/db/data-api";
import { deliverPendingEmails, deliveryError } from "../relay";
const companyId = randomUUID();
const notificationId = randomUUID();
const outboxId = randomUUID();
const instant = new Date("2026-09-28T06:00:00Z");
function fixture(
  input: { attempts?: number; status?: string; failure?: boolean } = {},
) {
  const state = {
    sent: false,
    delayed: false,
    status: input.status ?? "queued",
  };
  const writes: {
    sql: string;
    values: Record<string, Parameter["value"]>;
    tx: string | undefined;
  }[] = [];
  const executor = (role: "scheduler" | "app"): DataApiExecutor => ({
    begin: vi.fn(() => Promise.resolve(`${role}-tx`)),
    commit: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
    execute: vi.fn(
      (sql: string, params: readonly Parameter[] = [], tx?: string) => {
        const values = Object.fromEntries(params.map((p) => [p.name, p.value]));
        writes.push({ sql, values, tx });
        let result: Row[] = [];
        if (sql === "select id from core.company order by id")
          result = [{ id: companyId }];
        else if (sql.startsWith("select * from ops.outbox"))
          result =
            state.sent || state.delayed
              ? []
              : [
                  {
                    id: outboxId,
                    payload: { notificationId },
                    attempts: input.attempts ?? 0,
                    version: 1,
                  },
                ];
        else if (sql.startsWith("select * from work.notification"))
          result = [
            {
              id: notificationId,
              version: 1,
              status: state.status,
              recipient_account_id: randomUUID(),
              subject_type: "contract",
              subject_id: randomUUID(),
              template_code: "contract_approval_requested",
            },
          ];
        else if (sql.startsWith("select p.email")) {
          expect(role).toBe("app");
          result = [
            {
              email: "success+synthetic@simulator.amazonses.com",
              preferred_language: "ar",
            },
          ];
        } else if (sql.startsWith("select legal_name_en"))
          result = [
            {
              legal_name_en: "Company (synthetic)",
              legal_name_ar: "شركة (synthetic)",
            },
          ];
        else if (sql.startsWith("select contract_no"))
          result = [{ contract_no: "C-01" }];
        else if (sql.startsWith("update ops.outbox set sent_at"))
          state.sent = true;
        else if (sql.startsWith("update ops.outbox set attempts"))
          state.delayed = true;
        else if (sql.startsWith("update work.notification"))
          state.status = String(values.status);
        return Promise.resolve({ rows: result, numberOfRecordsUpdated: 1 });
      },
    ),
  });
  const schedulerExecutor = executor("scheduler");
  const appExecutor = executor("app");
  const send = vi.fn(() => {
    if (input.failure)
      return Promise.reject(
        new TypeError(
          `Delivery to private@example.invalid failed ${"x".repeat(500)}`,
        ),
      );
    return Promise.resolve({ messageId: "synthetic-message-id" });
  });
  return {
    options: {
      schedulerExecutor,
      appExecutor,
      email: { send },
      now: () => instant,
    },
    state,
    writes,
    send,
  };
}
describe("email outbox relay", () => {
  it("sends once, commits audited versions and attempts nothing on the next run", async () => {
    const f = fixture();
    expect(await deliverPendingEmails(f.options)).toEqual({
      attempted: 1,
      sent: 1,
      failed: 0,
      deadLettered: 0,
      skipped: 0,
    });
    expect(await deliverPendingEmails(f.options)).toEqual({
      attempted: 0,
      sent: 0,
      failed: 0,
      deadLettered: 0,
      skipped: 0,
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    const attempt = f.writes.find((w) =>
      w.sql.startsWith("insert into work.notification_attempt"),
    );
    expect(attempt?.values).toMatchObject({
      attempt: 1,
      outcome: "sent",
      message: "synthetic-message-id",
      code: null,
    });
    const event = f.writes.find((w) =>
      w.sql.startsWith("insert into audit.audit_event"),
    );
    expect(event?.values).toMatchObject({
      type: "notification.sent",
      notification: notificationId,
      before: 1,
      after: 2,
    });
    expect(event?.sql).toContain("'scheduler','system'");
    const subject = f.writes.find((w) =>
      w.sql.startsWith("insert into audit.event_subject"),
    );
    expect(subject?.values).toMatchObject({
      outbox: outboxId,
      version: 2,
      event: event?.values.event,
    });
    expect(
      f.writes
        .filter((w) => /^(insert|update)/u.test(w.sql))
        .every((w) => w.tx === "scheduler-tx"),
    ).toBe(true);
    expect(f.writes.some((w) => w.sql.includes("for update skip locked"))).toBe(
      true,
    );
  });
  it("marks an already sent notification's outbox without a send or attempt", async () => {
    const f = fixture({ status: "sent" });
    expect(
      await deliverPendingEmails({ ...f.options, companyId }),
    ).toMatchObject({ attempted: 0, sent: 0, skipped: 1 });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.state.sent).toBe(true);
    expect(
      f.writes.some((w) =>
        w.sql.startsWith("insert into work.notification_attempt"),
      ),
    ).toBe(false);
    expect(
      f.writes.find((w) => w.sql.startsWith("insert into audit.audit_event"))
        ?.values,
    ).toMatchObject({ before: null, after: null });
  });
  it.each([0, 7])(
    "records and delays failure after %i earlier failures",
    async (attempts) => {
      const f = fixture({ attempts, failure: true });
      expect(await deliverPendingEmails(f.options)).toMatchObject({
        attempted: 1,
        sent: 0,
        failed: 1,
        deadLettered: attempts === 7 ? 1 : 0,
      });
      expect(f.state.status).toBe("failed");
      const update = f.writes.find((w) =>
        w.sql.startsWith("update ops.outbox set attempts"),
      );
      expect(update?.values.attempt).toBe(attempts + 1);
      expect(update?.values.error).toMatch(
        /^TypeError: Delivery to \[address\] failed/u,
      );
      expect(String(update?.values.error)).toHaveLength(300);
      expect(update?.sql).toContain("power(2,:attempt) * interval '1 minute'");
      expect(update?.sql).toContain("when :attempt>=8 then now()");
      const attempt = f.writes.find((w) =>
        w.sql.startsWith("insert into work.notification_attempt"),
      );
      expect(attempt?.values.outcome).toBe(
        attempts === 7 ? "dead_lettered" : "failed",
      );
      expect(
        f.writes.find((w) => w.sql.startsWith("insert into audit.audit_event"))
          ?.values.type,
      ).toBe("notification.failed");
      expect((await deliverPendingEmails(f.options)).attempted).toBe(0);
    },
  );
  it("limits work globally and rejects invalid limits", async () => {
    const f = fixture();
    await deliverPendingEmails({ ...f.options, limit: 1 });
    expect(
      f.writes.filter((w) => w.sql.startsWith("select * from ops.outbox")),
    ).toHaveLength(1);
    await expect(
      deliverPendingEmails({ ...f.options, limit: 0 }),
    ).rejects.toThrow();
  });
  it("redacts addresses before truncation, including error names", () => {
    const error = new Error(
      "Address <person@example.invalid> could not receive mail",
    );
    error.name = "person@example.invalid";
    expect(deliveryError(error)).toEqual({
      code: "[address]",
      detail: "[address]: Address <[address]> could not receive mail",
    });
    expect(deliveryError("unknown")).toEqual({
      code: "DeliveryError",
      detail: "DeliveryError: Email delivery failed",
    });
  });
  it("rolls back the scheduler transaction if audit coverage cannot be written", async () => {
    const f = fixture();
    const execute = f.options.schedulerExecutor.execute;
    f.options.schedulerExecutor.execute = (sql, params, tx) => {
      if (sql.startsWith("insert into audit.audit_event"))
        return Promise.reject(new Error("Synthetic database failure"));
      return execute(sql, params, tx);
    };
    await expect(deliverPendingEmails(f.options)).rejects.toThrow(
      "Synthetic database failure",
    );
    expect(f.options.schedulerExecutor.rollback).toHaveBeenCalledWith(
      "scheduler-tx",
    );
    expect(f.options.schedulerExecutor.commit).not.toHaveBeenCalled();
  });
});
