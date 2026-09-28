import { describe, it, expect } from "vitest";
import { z } from "zod";
import fixture from "../../fixtures/audit/canon-v1.json";
import {
  auditEventContent,
  auditEventCanonicalText,
  computeRowHash,
  CANON_VERSION,
  GENESIS_PREV_HASH,
} from "./index";

const base = auditEventContent.parse(fixture.event_cases[0]?.content);

describe("stored audit event projection", () => {
  it("contains exactly three consecutive events for one synthetic company", () => {
    expect(fixture.event_cases.map((event) => event.content.seq)).toEqual([
      1, 2, 3,
    ]);
    expect(
      new Set(fixture.event_cases.map((event) => event.content.company_id))
        .size,
    ).toBe(1);
  });

  it.each(fixture.event_cases)(
    "matches the hand-written projection for $name",
    (event) => {
      expect(
        auditEventCanonicalText(auditEventContent.parse(event.content)),
      ).toBe(event.expected_canonical_text);
    },
  );

  it.each(
    fixture.event_cases.map((event, index) => ({
      ...event,
      previous:
        index === 0
          ? GENESIS_PREV_HASH
          : fixture.event_cases[index - 1]?.expected_row_hash,
    })),
  )("matches independent chained hashes for $name", (event) => {
    expect(event.expected_prev_hash).toBe(event.previous);
    expect(
      computeRowHash({
        prevHash: event.expected_prev_hash,
        canonVersion: CANON_VERSION,
        canonicalText: auditEventCanonicalText(
          auditEventContent.parse(event.content),
        ),
      }),
    ).toBe(event.expected_row_hash);
  });

  it.each([
    ["2026-09-28T02:05:00Z", "2026-09-28T02:05:00.000000Z"],
    ["2026-09-28T02:05:00.5Z", "2026-09-28T02:05:00.500000Z"],
    ["2026-09-28T02:05:00.12Z", "2026-09-28T02:05:00.120000Z"],
    ["2026-09-28T02:05:00.123Z", "2026-09-28T02:05:00.123000Z"],
    ["2026-09-28T02:05:00.1234Z", "2026-09-28T02:05:00.123400Z"],
    ["2026-09-28T02:05:00.12345Z", "2026-09-28T02:05:00.123450Z"],
    ["2026-09-28T02:05:00.123456Z", "2026-09-28T02:05:00.123456Z"],
  ])("pads the timestamp %s to six digits", (occurred_at, expected) => {
    expect(auditEventCanonicalText({ ...base, occurred_at })).toContain(
      `"occurred_at":"${expected}"`,
    );
  });

  it.each([
    ["event_id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
    ["company_id", "not-a-uuid"],
    ["actor_account_id", "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB"],
    ["on_behalf_of", "invalid"],
    ["subject_id", "invalid"],
    ["drafted_action_id", "invalid"],
    ["model_call_ids", ["invalid"]],
    ["seq", 0],
    ["seq", 2 ** 53],
    ["seq", 1.5],
    ["occurred_at", "2026-09-28T02:05:00+00:00"],
    ["occurred_at", "2026-09-28T02:05:00.1234567Z"],
    ["occurred_at", "2026-02-29T02:05:00Z"],
    ["occurred_at", "2026-09-28T02:05Z"],
    ["occurred_at", "2026-09-28T24:00:00Z"],
    ["occurred_at", "2026-09-28T02:05:60Z"],
    ["tx_id", "-1"],
    ["tx_id", "1.2"],
    ["event_type", "Contract.created"],
    ["event_type", "contract.created.extra"],
    ["actor_role", "admin"],
    ["initiator", "robot"],
    ["channel", "http"],
    ["subject_type", "contractVersion"],
    ["version_before", -1],
    ["version_after", 1.5],
    ["changed_fields", ["amountFils"]],
    ["field_provenance", { amountFils: "human_entered" }],
    ["field_provenance", { amount_fils: "unconfirmed" }],
    ["field_provenance", { _amount: "human_entered" }],
    ["before_hash", "a".repeat(63)],
    ["after_hash", "A".repeat(64)],
    ["policy_decision", { policy_version: "v1", result: "maybe", reasons: [] }],
    [
      "policy_decision",
      { policy_version: "v1", result: "allow", reasons: [], extra: true },
    ],
    ["visibility", "private"],
    ["retention_class", "forever"],
  ])("rejects malformed field %s with value %j", (field, value) => {
    expect(
      auditEventContent.safeParse({ ...base, [field]: value }).success,
    ).toBe(false);
  });

  it.each(Object.keys(base))(
    "requires stored field %s even when nullable",
    (field) => {
      const content = Object.fromEntries(
        Object.entries(base).filter(([key]) => key !== field),
      );
      expect(auditEventContent.safeParse(content).success).toBe(false);
    },
  );

  it.each(["extra", "prev_hash", "row_hash", "canon_version"])(
    "rejects undeclared field %s",
    (field) => {
      expect(
        auditEventContent.safeParse({ ...base, [field]: "synthetic" }).success,
      ).toBe(false);
    },
  );

  it("accepts lowercase UUID storage values without imposing version bits", () => {
    expect(
      auditEventContent.safeParse({
        ...base,
        event_id: "00000000-0000-0000-0000-000000000001",
      }).success,
    ).toBe(true);
  });

  it("throws TypeError for malformed programmer input during projection", () => {
    expect(() => auditEventCanonicalText({ ...base, seq: 0 })).toThrow(
      TypeError,
    );
  });

  it("throws TypeError for lone surrogates in event text", () => {
    expect(() =>
      auditEventCanonicalText({ ...base, reason: "\uD800" }),
    ).toThrow(TypeError);
  });

  it("projects zero versions and nullable fields without dropping them", () => {
    const text = auditEventCanonicalText({
      ...base,
      version_before: 0,
      reason: null,
    });
    expect(text).toContain('"version_before":"0"');
    expect(text).toContain('"reason":null');
    expect(
      Object.keys(z.record(z.string(), z.unknown()).parse(JSON.parse(text))),
    ).toHaveLength(Object.keys(base).length);
  });

  it("leaves the stored timestamp and field order unchanged", () => {
    auditEventCanonicalText(base);
    expect(base.occurred_at).toBe("2026-09-28T02:05:00Z");
    expect(base.changed_fields).toEqual(["amount_fils", "status"]);
  });
});
