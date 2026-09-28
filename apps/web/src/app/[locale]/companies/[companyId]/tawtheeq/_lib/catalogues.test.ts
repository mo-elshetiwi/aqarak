import { describe, expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    expect(value.trim().length, prefix).toBeGreaterThan(0);
    return [prefix];
  }
  if (!value || typeof value !== "object")
    throw new Error(`Invalid catalogue at ${prefix}`);
  return Object.entries(value)
    .flatMap(([key, item]) => paths(item, `${prefix}.${key}`))
    .sort();
}
describe("Tawtheeq bilingual catalogue", () => {
  it("AC-8 has identical English and Arabic key paths with no empty strings", () => {
    expect(paths(getMessages("en").Tawtheeq)).toEqual(
      paths(getMessages("ar").Tawtheeq),
    );
  });
});

it("AC-9 Audit and Tawtheeq have identical bilingual key paths and no empty strings", () => {
  for (const namespace of ["Audit", "Tawtheeq"] as const)
    expect(paths(getMessages("en")[namespace])).toEqual(
      paths(getMessages("ar")[namespace]),
    );
});
