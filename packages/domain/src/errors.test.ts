import { describe, it, expect } from "vitest";
import {
  checkExpectedVersion,
  coreErrorCode,
  reason,
  refuse,
  requireReason,
  type DomainError,
  type Result,
} from "./index";

describe("domain refusals", () => {
  it("omits the field property when no field is supplied", () => {
    expect(refuse("INVALID_INPUT")).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
  it("retains the field when supplied", () => {
    expect(refuse("INVALID_INPUT", "amount")).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "amount" },
    });
  });
  it("preserves an empty field when explicitly supplied", () => {
    expect(refuse("INVALID_INPUT", "")).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "" },
    });
  });
  it("defaults results to domain refusals", () => {
    const error: DomainError = { code: "INVALID_INPUT" };
    const result: Result<number> = { ok: false, error };
    expect(result.error).toBe(error);
  });
  it("preserves the closed shared refusal code list", () => {
    expect(coreErrorCode.options).toEqual([
      "INVALID_TRANSITION",
      "VERSION_CONFLICT",
      "REASON_REQUIRED",
      "INVALID_INPUT",
    ]);
  });
  it("refuses an unknown shared refusal code", () => {
    expect(coreErrorCode.safeParse("UNKNOWN").success).toBe(false);
  });
});

describe("mandatory reasons", () => {
  it.each(["", "  ", "\t\n", null, undefined])(
    "refuses a missing reason: %s",
    (value) => {
      expect(requireReason(value)).toEqual({
        ok: false,
        error: { code: "REASON_REQUIRED", field: "reason" },
      });
    },
  );
  it("returns a trimmed reason when text is supplied", () => {
    expect(requireReason(" late payment ")).toEqual({
      ok: true,
      value: "late payment",
    });
  });
  it("accepts a reason at the maximum length after trimming", () => {
    expect(requireReason(` ${"x".repeat(1000)} `)).toEqual({
      ok: true,
      value: "x".repeat(1000),
    });
  });
  it("refuses a reason beyond the maximum length", () => {
    expect(requireReason("x".repeat(1001))).toEqual({
      ok: false,
      error: { code: "REASON_REQUIRED", field: "reason" },
    });
  });
  it("accepts a one character reason", () => {
    expect(reason.parse(" x ")).toBe("x");
  });
});

describe("optimistic concurrency", () => {
  it("refuses a stale expected version", () => {
    expect(checkExpectedVersion(3, 2)).toEqual({
      ok: false,
      error: { code: "VERSION_CONFLICT" },
    });
  });
  it("accepts a matching expected version", () => {
    expect(checkExpectedVersion(3, 3)).toEqual({ ok: true, value: undefined });
  });
  it("refuses an expected version ahead of the current version", () => {
    expect(checkExpectedVersion(3, 4)).toEqual({
      ok: false,
      error: { code: "VERSION_CONFLICT" },
    });
  });
});
