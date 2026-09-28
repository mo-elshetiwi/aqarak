import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { requestSha256 } from "@aqarak/domain";
import {
  createAuthenticator,
  expectVersion,
  problemResponse,
  Refusal,
} from "./index";

describe("identity authentication", () => {
  it("rejects missing authorization before reading runtime configuration", async () => {
    expect(await createAuthenticator().authenticate(new Headers())).toBeNull();
  });
});

describe("kernel contracts", () => {
  it.each([
    ["VALIDATION_FAILED", 400],
    ["SESSION_INVALID", 401],
    ["NOT_PERMITTED", 403],
    ["NOT_FOUND", 404],
    ["METHOD_NOT_ALLOWED", 405],
    ["STALE_VERSION", 409],
    ["INVALID_TRANSITION", 409],
    ["REASON_REQUIRED", 422],
    ["IDEMPOTENCY_KEY_REUSED", 422],
    ["UNAVAILABLE", 503],
  ] as const)("maps %s to a no-store problem", async (code, status) => {
    const response = problemResponse(code);
    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      code,
      status,
    });
  });
  it("hashes validated path and body independent of property order", () => {
    expect(
      requestSha256({
        pathParams: { companyId: "a", id: "b" },
        body: { x: 1, y: 2 },
      }),
    ).toBe(
      requestSha256({
        pathParams: { id: "b", companyId: "a" },
        body: { y: 2, x: 1 },
      }),
    );
  });
  it("refuses stale versions with the target subject", () => {
    const subject = { type: "company", id: randomUUID() };
    expect(() => {
      expectVersion(2, 2, subject);
    }).not.toThrow();
    expect(() => {
      expectVersion(2, 1, subject);
    }).toThrow(new Refusal("STALE_VERSION", subject));
  });
});
