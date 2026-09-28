import { expect, it, vi } from "vitest";
import { fakeExecutor } from "../test-helpers.ts";
import {
  AUDIT_CONTENT_KEYS,
  AUDIT_KNOWN_ANSWER_SQL,
  AUDIT_KNOWN_HASH,
  AUDIT_PAYLOAD_KEYS_SQL,
  checkAuditContent,
} from "./audit-content.ts";
import { cover } from "./fixtures.ts";

function contentRow() {
  return {
    keys: [...AUDIT_CONTENT_KEYS].sort(),
    occurred_at: "2026-09-28T03:00:00.123456Z",
    tx_id_type: "number",
    tx_id: "1234567890123456789",
    empty_is_null: true,
  };
}

function contentExecutor(row = contentRow(), hash = AUDIT_KNOWN_HASH) {
  const executor = fakeExecutor();
  vi.mocked(executor.execute)
    .mockResolvedValueOnce({
      rows: [{ row_hash: hash }],
      numberOfRecordsUpdated: 0,
    })
    .mockResolvedValueOnce({ rows: [row], numberOfRecordsUpdated: 0 });
  return executor;
}

it("checks the hash and exactly 30 content keys using only two read-only statements", async () => {
  const executor = contentExecutor();
  await expect(checkAuditContent(executor)).resolves.toEqual({
    rowHash: AUDIT_KNOWN_HASH,
    keys: [...AUDIT_CONTENT_KEYS].sort(),
    verified: true,
  });
  expect(AUDIT_CONTENT_KEYS).toHaveLength(30);
  expect(executor.execute).toHaveBeenCalledTimes(2);
  expect(executor.execute).toHaveBeenNthCalledWith(1, AUDIT_KNOWN_ANSWER_SQL);
  expect(executor.execute).toHaveBeenNthCalledWith(2, AUDIT_PAYLOAD_KEYS_SQL);
  expect(executor.begin).not.toHaveBeenCalled();
});

it("rejects a different hash before examining the payload", async () => {
  const executor = contentExecutor(contentRow(), "0".repeat(64));
  await expect(checkAuditContent(executor)).rejects.toThrow(
    "known-answer hash mismatch",
  );
  expect(executor.execute).toHaveBeenCalledTimes(1);
});

it.each(["details", "prev_hash", "row_hash", "canon_version", "missing_tx_id"])(
  "rejects a payload with %s",
  async (key) => {
    const row = contentRow();
    const keys: string[] =
      key === "missing_tx_id"
        ? row.keys.filter((value) => value !== "tx_id")
        : [...row.keys, key].sort();
    const executor = fakeExecutor();
    vi.mocked(executor.execute)
      .mockResolvedValueOnce({
        rows: [{ row_hash: AUDIT_KNOWN_HASH }],
        numberOfRecordsUpdated: 0,
      })
      .mockResolvedValueOnce({
        rows: [{ ...row, keys }],
        numberOfRecordsUpdated: 0,
      });
    await expect(checkAuditContent(executor)).rejects.toThrow(
      "exactly the 30 shared content keys",
    );
  },
);

it.each([
  { occurred_at: "2026-09-28T03:00:00.123Z" },
  { occurred_at: "2026-09-28T07:00:00.123456Z" },
  { tx_id_type: "string" },
  { tx_id: "1234567890123456800" },
  { empty_is_null: false },
])(
  "rejects incorrect timestamp, transaction id or null encoding: %j",
  async (change) => {
    await expect(
      checkAuditContent(contentExecutor({ ...contentRow(), ...change })),
    ).rejects.toThrow("timestamp, transaction id or null encoding mismatch");
  },
);

it("accepts JSON encoded result keys from the Data API", async () => {
  const executor = fakeExecutor();
  const row = contentRow();
  vi.mocked(executor.execute)
    .mockResolvedValueOnce({
      rows: [{ row_hash: AUDIT_KNOWN_HASH }],
      numberOfRecordsUpdated: 0,
    })
    .mockResolvedValueOnce({
      rows: [{ ...row, keys: JSON.stringify(row.keys) }],
      numberOfRecordsUpdated: 0,
    });
  await expect(checkAuditContent(executor)).resolves.toHaveProperty(
    "verified",
    true,
  );
});

it("keeps the spike covering event compatible with the removed details column", async () => {
  const executor = fakeExecutor();
  await cover(executor, "company", "company", "subject");
  const call = vi.mocked(executor.execute).mock.calls[0];
  expect(call?.[0]).toContain("insert into audit.audit_event");
  expect(call?.[0]).not.toContain("details");
  expect(call?.[1]?.some(({ name }) => name === "details")).toBe(false);
});
