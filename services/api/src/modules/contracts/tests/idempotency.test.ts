import { expect, it, vi } from "vitest";
import { claimIdempotency } from "../runtime/idempotency";
import { requestSha256 } from "../runtime/domain";
import type { AuditActor } from "../runtime/audit";
const actor: AuditActor = {
  companyId: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  role: "manager",
  channel: "web_form",
  traceId: null,
  key: "synthetic-key-value",
};
it.each([false, true])(
  "replays the validated Data API response representation: %s",
  async (encoded) => {
    const response = {
      status: 200,
      body: { contract: { status: "awaiting_owner_approval" } },
    };
    const body = { expectedVersion: 1 };
    const pathParams = { companyId: actor.companyId };
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], numberOfRecordsUpdated: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            request_sha256: requestSha256({ pathParams, body }),
            response: encoded ? JSON.stringify(response) : response,
            created_at: "2026-09-28T00:00:00Z",
          },
        ],
        numberOfRecordsUpdated: 0,
      });
    expect(
      await claimIdempotency(
        { execute },
        {
          actor,
          command: "submit",
          body,
          pathParams,
          now: "2026-09-28T01:00:00Z",
        },
      ),
    ).toEqual(response);
    expect(execute).toHaveBeenCalledTimes(2);
  },
);
