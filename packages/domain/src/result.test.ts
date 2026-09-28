import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "./index";
function readOutcome(result: Result<number, string>): number | string {
  return result.ok ? result.value : result.error;
}
describe("expected outcomes", () => {
  it("preserves a successful value", () => {
    expect(ok(4)).toEqual({ ok: true, value: 4 });
  });
  it("preserves a refusal", () => {
    expect(err("refused")).toEqual({ ok: false, error: "refused" });
  });
  it("narrows success to its value", () => {
    expect(readOutcome(ok(4))).toBe(4);
  });
  it("narrows refusal to its error", () => {
    expect(readOutcome(err("refused"))).toBe("refused");
  });
});
