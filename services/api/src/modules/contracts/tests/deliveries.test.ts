import { expect, it, vi } from "vitest";
import type { CompanyTransaction } from "../runtime/db";
import { contractDeliveries } from "../deliveries";
it("reports attempt totals and only the last attempt's dead-letter outcome", async () => {
  const execute = vi.fn<CompanyTransaction["execute"]>(() =>
    Promise.resolve({
      rows: [
        {
          id: "queued",
          channel: "email",
          template_code: "synthetic",
          status: "failed",
          created_at: "2026-09-28T06:00:00Z",
          attempts: "0",
          last_outcome: null,
          last_error_code: null,
        },
        {
          id: "retry",
          channel: "email",
          template_code: "synthetic",
          status: "failed",
          created_at: "2026-09-28T06:00:00Z",
          attempts: "2",
          last_outcome: "failed",
          last_error_code: "MessageRejected",
        },
        {
          id: "exhausted",
          channel: "email",
          template_code: "synthetic",
          status: "failed",
          created_at: "2026-09-28T06:00:00Z",
          attempts: "8",
          last_outcome: "dead_lettered",
          last_error_code: "ServiceUnavailable",
        },
        {
          id: "sent",
          channel: "email",
          template_code: "synthetic",
          status: "failed",
          created_at: "2026-09-28T06:00:00Z",
          attempts: "3",
          last_outcome: "sent",
          last_error_code: null,
        },
      ],
      numberOfRecordsUpdated: 0,
    }),
  );
  const tx: CompanyTransaction = { execute };
  expect(await contractDeliveries(tx, "synthetic-contract")).toMatchObject([
    {
      notificationId: "queued",
      attempts: 0,
      deadLettered: false,
      lastErrorCode: null,
    },
    {
      notificationId: "retry",
      attempts: 2,
      deadLettered: false,
      lastErrorCode: "MessageRejected",
    },
    {
      notificationId: "exhausted",
      attempts: 8,
      deadLettered: true,
      lastErrorCode: "ServiceUnavailable",
    },
    {
      notificationId: "sent",
      attempts: 3,
      deadLettered: false,
      lastErrorCode: null,
    },
  ]);
  const sql = execute.mock.calls[0]?.[0] ?? "";
  expect(sql).toContain("count(*) from work.notification_attempt");
  expect(sql).toContain("a.company_id=n.company_id");
  expect(sql).toContain("order by a.attempt_no desc limit 1");
});
