import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  idempotencyKey,
  IDEMPOTENCY_RETENTION_DAYS,
  idempotencyErrorCode,
  idempotencyError,
  storedIdempotency,
  idempotencyDecision,
  requestSha256,
  decideIdempotency,
  firingDedupeKey,
  type StoredIdempotency,
} from "./index";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const now = "2026-09-28T02:05:00.123456Z";
const response = { status: "accepted", seq: 1 };
const stored: StoredIdempotency = {
  request_sha256: hash,
  response,
  created_at: "2026-09-27T02:05:00.123456Z",
};

describe("idempotency key schema", () => {
  it.each(["a".repeat(16), "Z".repeat(128), "synthetic_key-001"])(
    "accepts bounded ASCII key %j",
    (value) => {
      expect(idempotencyKey.parse(value)).toBe(value);
    },
  );

  it.each([
    "",
    "a".repeat(15),
    "a".repeat(129),
    "synthetic key 001",
    "synthetic:key:001",
    "synthetic_key_عقار",
    "synthetic_key_001\n",
  ])("rejects invalid key %j", (value) => {
    expect(idempotencyKey.safeParse(value).success).toBe(false);
  });

  it("sets retention to seven days", () => {
    expect(IDEMPOTENCY_RETENTION_DAYS).toBe(7);
  });
});

describe("canonical request identity", () => {
  it("ignores body and path key insertion order", () => {
    expect(
      requestSha256({
        pathParams: {
          companyId: "synthetic_company",
          subjectId: "synthetic_subject",
        },
        body: { amountFils: 150000, nested: { b: 2, a: 1 } },
      }),
    ).toBe(
      requestSha256({
        pathParams: {
          subjectId: "synthetic_subject",
          companyId: "synthetic_company",
        },
        body: { nested: { a: 1, b: 2 }, amountFils: 150000 },
      }),
    );
  });

  it("ignores insignificant whitespace in parsed JSON bodies", () => {
    const compact = z
      .json()
      .parse(JSON.parse('{"amountFils":1.50,"active":true}'));
    const spaced = z
      .json()
      .parse(JSON.parse('  { "active" : true,\n "amountFils" : 1.5 }  '));
    expect(requestSha256({ pathParams: {}, body: compact })).toBe(
      requestSha256({ pathParams: {}, body: spaced }),
    );
  });

  it("changes when a body value changes", () => {
    expect(requestSha256({ pathParams: {}, body: { amountFils: 1 } })).not.toBe(
      requestSha256({ pathParams: {}, body: { amountFils: 2 } }),
    );
  });

  it("changes when a path parameter changes", () => {
    expect(
      requestSha256({ pathParams: { id: "synthetic_a" }, body: null }),
    ).not.toBe(
      requestSha256({ pathParams: { id: "synthetic_b" }, body: null }),
    );
  });

  it("preserves significant whitespace in string values", () => {
    expect(requestSha256({ pathParams: {}, body: "a b" })).not.toBe(
      requestSha256({ pathParams: {}, body: "ab" }),
    );
  });

  it("uses null for an absent body", () => {
    expect(requestSha256({ pathParams: {}, body: null })).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(requestSha256({ pathParams: {}, body: null })).not.toBe(
      requestSha256({ pathParams: {}, body: {} }),
    );
  });

  it("uses the same canonical identity for numbers and their decimal strings", () => {
    expect(requestSha256({ pathParams: {}, body: { value: 1 } })).toBe(
      requestSha256({ pathParams: {}, body: { value: "1" } }),
    );
  });

  it("rejects invalid path parameter keys", () => {
    expect(() =>
      requestSha256({ pathParams: { "subject-id": "synthetic" }, body: null }),
    ).toThrow(TypeError);
  });
});

describe("scoped idempotency decisions", () => {
  it.each([
    {
      name: "no stored row",
      stored: null,
      request: hash,
      expected: { ok: true, value: { kind: "proceed" } },
    },
    {
      name: "same request with response",
      stored,
      request: hash,
      expected: { ok: true, value: { kind: "replay", response } },
    },
    {
      name: "different request within retention",
      stored,
      request: otherHash,
      expected: { ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } },
    },
    {
      name: "eight-day-old row",
      stored: { ...stored, created_at: "2026-09-20T02:05:00.123456Z" },
      request: otherHash,
      expected: { ok: true, value: { kind: "proceed" } },
    },
    {
      name: "same request without response",
      stored: { ...stored, response: null },
      request: hash,
      expected: { ok: true, value: { kind: "proceed" } },
    },
    {
      name: "different request without response",
      stored: { ...stored, response: null },
      request: otherHash,
      expected: { ok: true, value: { kind: "proceed" } },
    },
  ])(
    "returns the expected decision for $name",
    ({ stored: saved, request, expected }) => {
      expect(
        decideIdempotency({ stored: saved, requestSha256: request, now }),
      ).toEqual(expected);
    },
  );

  it.each([false, 0, "", [], {}])(
    "replays a non-null response even when falsy or empty: %j",
    (savedResponse) => {
      expect(
        decideIdempotency({
          stored: { ...stored, response: savedResponse },
          requestSha256: hash,
          now,
        }),
      ).toEqual({
        ok: true,
        value: { kind: "replay", response: savedResponse },
      });
    },
  );

  it("treats a future stored timestamp as still within retention", () => {
    expect(
      decideIdempotency({
        stored: { ...stored, created_at: "2026-09-28T02:05:00.123457Z" },
        requestSha256: hash,
        now,
      }),
    ).toEqual({ ok: true, value: { kind: "replay", response } });
  });

  it("retains a row at exactly seven days", () => {
    expect(
      decideIdempotency({
        stored: { ...stored, created_at: "2026-09-21T02:05:00.123456Z" },
        requestSha256: otherHash,
        now,
      }),
    ).toEqual({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  it("expires a row one microsecond beyond seven days", () => {
    expect(
      decideIdempotency({
        stored: { ...stored, created_at: "2026-09-21T02:05:00.123455Z" },
        requestSha256: otherHash,
        now,
      }),
    ).toEqual({ ok: true, value: { kind: "proceed" } });
  });

  it("retains a row one microsecond before seven days", () => {
    expect(
      decideIdempotency({
        stored: { ...stored, created_at: "2026-09-21T02:05:00.123457Z" },
        requestSha256: otherHash,
        now,
      }),
    ).toEqual({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  });

  it("compares equivalent UTC precision without changing the age", () => {
    expect(
      decideIdempotency({
        stored: { ...stored, created_at: "2026-09-21T02:05:00Z" },
        requestSha256: hash,
        now: "2026-09-28T02:05:00.000000Z",
      }),
    ).toEqual({ ok: true, value: { kind: "replay", response } });
  });

  it.each([
    { stored, requestSha256: "invalid", now },
    {
      stored: { ...stored, request_sha256: "invalid" },
      requestSha256: hash,
      now,
    },
    { stored: { ...stored, created_at: "invalid" }, requestSha256: hash, now },
    { stored, requestSha256: hash, now: "invalid" },
    { stored, requestSha256: hash, now: "2026-09-28T02:05:00+00:00" },
    { stored, requestSha256: hash, now: "2026-02-29T02:05:00Z" },
    { stored, requestSha256: hash, now: "2026-09-28T02:05:00.1234567Z" },
  ])("throws for malformed hashes or UTC instants %#", (input) => {
    expect(() => decideIdempotency(input)).toThrow(TypeError);
  });

  it("leaves stored data unchanged", () => {
    const frozen = Object.freeze({
      ...stored,
      response: Object.freeze({ ...response }),
    });
    decideIdempotency({ stored: frozen, requestSha256: hash, now });
    expect(frozen).toEqual(stored);
  });

  it("validates stored shapes and decisions with the exported schemas", () => {
    expect(
      storedIdempotency.parse({
        ...stored,
        response: { nested: [null, true, 1, "synthetic"] },
      }),
    ).toEqual({
      ...stored,
      response: { nested: [null, true, 1, "synthetic"] },
    });
    expect(idempotencyDecision.parse({ kind: "replay", response })).toEqual({
      kind: "replay",
      response,
    });
    expect(idempotencyDecision.parse({ kind: "proceed" })).toEqual({
      kind: "proceed",
    });
    expect(idempotencyError.parse({ code: "IDEMPOTENCY_KEY_REUSED" })).toEqual({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(idempotencyErrorCode.options).toEqual(["IDEMPOTENCY_KEY_REUSED"]);
  });
});

describe("reminder firing identity", () => {
  const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("combines rule, subject and Asia/Dubai date", () => {
    expect(
      firingDedupeKey({ ruleCode: "n3", subjectId, fireOn: "2026-09-28" }),
    ).toBe(`n3:${subjectId}:2026-09-28`);
  });

  it.each(["n1", "n9", "n10", "n13"])("accepts valid rule %s", (ruleCode) => {
    expect(firingDedupeKey({ ruleCode, subjectId, fireOn: "2024-02-29" })).toBe(
      `${ruleCode}:${subjectId}:2024-02-29`,
    );
  });

  it.each([
    { ruleCode: "n14", subjectId, fireOn: "2026-09-28" },
    { ruleCode: "n0", subjectId, fireOn: "2026-09-28" },
    { ruleCode: "n03", subjectId, fireOn: "2026-09-28" },
    { ruleCode: "n3", subjectId, fireOn: "28-09-2026" },
    { ruleCode: "n3", subjectId, fireOn: "2026-02-29" },
    { ruleCode: "n3", subjectId, fireOn: "2026-04-31" },
    { ruleCode: "n3", subjectId, fireOn: "2026-09-28T00:00:00Z" },
    { ruleCode: "n3", subjectId: "", fireOn: "2026-09-28" },
    { ruleCode: "n3", subjectId: "synthetic:subject", fireOn: "2026-09-28" },
    { ruleCode: "n3", subjectId: "\uD800", fireOn: "2026-09-28" },
  ])("rejects malformed firing identity %#", (input) => {
    expect(() => firingDedupeKey(input)).toThrow(TypeError);
  });
});
