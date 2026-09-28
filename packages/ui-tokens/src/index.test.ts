import { describe, it, expect } from "vitest";
import { typeScalePx, radiusPx, minimumTargetSize } from "./index";
function ascends(values: readonly number[]): boolean {
  return values
    .slice(1)
    .every(
      (value, index) => value > (values[index] ?? Number.POSITIVE_INFINITY),
    );
}
describe("design scales", () => {
  it("increases every type size", () => {
    expect(ascends(typeScalePx)).toBe(true);
  });
  it("increases every corner radius", () => {
    expect(ascends(Object.values(radiusPx))).toBe(true);
  });
  it.each([
    [minimumTargetSize.webCssPx, 24],
    [minimumTargetSize.webDefaultCssPx, 24],
    [minimumTargetSize.iosPt, 44],
    [minimumTargetSize.androidDp, 48],
  ])("keeps target %s at its platform minimum %s", (size, minimum) => {
    expect(size).toBeGreaterThanOrEqual(minimum);
  });
});
