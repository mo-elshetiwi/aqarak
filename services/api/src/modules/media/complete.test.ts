import { randomUUID } from "node:crypto";
import type { DataApiExecutor, Parameter } from "@aqarak/db/data-api";
import { expect, it, vi } from "vitest";
import { completeUpload } from "./commands";
import { createRuntime } from "../maintenance/runtime";
import type { StoragePort } from "./storage";
import { requestSha256 } from "@aqarak/domain";
import { Problem } from "../maintenance/problem";

function completionFixture(options: {
  mismatch?: "size" | "checksum";
  replay?: boolean;
  missing?: boolean;
}) {
  const companyId = randomUUID();
  const account = randomUUID();
  const mediaId = randomUUID();
  const row = {
    id: mediaId,
    company_id: companyId,
    unit_id: randomUUID(),
    kind: "photo",
    content_type: "image/jpeg",
    byte_size: "12",
    sha256: "ab".repeat(32),
    duration_ms: null,
    processing_status: options.replay ? "uploaded" : "awaiting_upload",
    version: options.replay ? "2" : "1",
    created_at: "2026-09-28 00:00:00.123456",
    uploaded_by_account_id: account,
    bucket: "synthetic-bucket",
    s3_key: "synthetic-key",
    s3_version_id: null,
    ticket_id: null,
  };
  const response = {
    status: 200,
    body: { media: { id: mediaId, version: 2 } },
  };
  let hash = "";
  const calls: { sql: string; parameters: readonly Parameter[] }[] = [];
  const db: DataApiExecutor = {
    begin: vi.fn().mockResolvedValue("synthetic-tx"),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    execute: vi
      .fn()
      .mockImplementation(
        (sql: string, parameters: readonly Parameter[] = []) => {
          calls.push({ sql, parameters });
          let rows: Record<string, unknown>[] = [];
          if (sql.includes("from core.person_account"))
            rows = [{ id: account }];
          else if (sql.includes("from core.membership"))
            rows = [
              {
                kind: "membership",
                data: { is_manager: true },
              },
            ];
          else if (sql.startsWith("select * from maint.media")) rows = [row];
          else if (sql.startsWith("select request_sha256") && options.replay)
            rows = [{ request_sha256: hash, response }];
          else if (sql.startsWith("insert into ops.idempotency_key"))
            rows = [{ key: "synthetic-key" }];
          else if (sql.startsWith("update maint.media"))
            rows = [
              {
                ...row,
                version: "2",
                processing_status: "scan_rejected",
                s3_version_id: "synthetic-version",
              },
            ];
          return Promise.resolve({ rows, numberOfRecordsUpdated: 0 });
        },
      ),
  };
  const storage: StoragePort = {
    upload: vi.fn(),
    download: vi.fn(),
    head: vi.fn().mockResolvedValue(
      options.missing
        ? null
        : {
            byteSize: options.mismatch === "size" ? 13 : 12,
            checksum:
              options.mismatch === "checksum"
                ? "wrong"
                : Buffer.from(row.sha256, "hex").toString("base64"),
            versionId: "synthetic-version",
          },
    ),
  };
  const runtime = createRuntime({ db, storage });
  const request = new Request("https://synthetic.invalid", {
    method: "POST",
    headers: { "Idempotency-Key": "synthetic-key" },
    body: JSON.stringify({ expectedVersion: 1 }),
  });
  return {
    runtime,
    db,
    storage,
    request,
    calls,
    scope: { companyId, subject: account, channel: "mobile_form" as const },
    mediaId,
    response,
    setHash(value: string) {
      hash = value;
    },
  };
}
it.each(["size", "checksum"] as const)(
  "records one rejected version with the %s mismatch reason",
  async (mismatch) => {
    const fixture = completionFixture({ mismatch });
    const result = await completeUpload(
      fixture.runtime,
      fixture.scope,
      fixture.request,
      fixture.mediaId,
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ code: "UPLOAD_MISMATCH" });
    const writes = fixture.calls.filter((call) =>
      call.sql.startsWith("update maint.media"),
    );
    expect(writes).toHaveLength(1);
    const events = fixture.calls.filter((call) =>
      call.sql.startsWith("insert into audit.audit_event"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.parameters).toEqual(
      expect.arrayContaining([
        { name: "event", value: "media.upload_rejected" },
        { name: "reason", value: `${mismatch}_mismatch` },
        { name: "before", value: 1 },
        { name: "after", value: 2 },
        { name: "key", value: "synthetic-key" },
      ]),
    );
    expect(
      fixture.calls.filter((call) =>
        call.sql.startsWith("update ops.idempotency_key"),
      ),
    ).toHaveLength(1);
    expect(fixture.db.commit).toHaveBeenCalledTimes(2);
    const headOrder =
      vi.mocked(fixture.storage.head).mock.invocationCallOrder[0] ?? 0;
    const writeBeginOrder =
      vi.mocked(fixture.db.begin).mock.invocationCallOrder[1] ?? 0;
    expect(headOrder).toBeLessThan(writeBeginOrder);
  },
);
it("returns upload-not-found before opening a write transaction", async () => {
  const fixture = completionFixture({ missing: true });
  const error: unknown = await completeUpload(
    fixture.runtime,
    fixture.scope,
    fixture.request,
    fixture.mediaId,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Problem);
  if (error instanceof Problem)
    expect(error.body.code).toBe("UPLOAD_NOT_FOUND");
  expect(fixture.db.begin).toHaveBeenCalledOnce();
  expect(fixture.calls.some((call) => /^(insert|update)/u.test(call.sql))).toBe(
    false,
  );
});

it("replays completed uploads before checking the old expected version or calling S3", async () => {
  const fixture = completionFixture({ replay: true });
  fixture.setHash(
    requestSha256({
      pathParams: {
        companyId: fixture.scope.companyId,
        mediaId: fixture.mediaId,
      },
      body: { expectedVersion: 1 },
    }),
  );
  expect(
    await completeUpload(
      fixture.runtime,
      fixture.scope,
      fixture.request,
      fixture.mediaId,
    ),
  ).toEqual({ ...fixture.response, replayed: true });
  expect(fixture.storage.head).not.toHaveBeenCalled();
  expect(fixture.calls.some((call) => /^(insert|update)/u.test(call.sql))).toBe(
    false,
  );
});
