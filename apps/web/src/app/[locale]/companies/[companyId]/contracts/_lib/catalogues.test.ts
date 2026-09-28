import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getMessages } from "@aqarak/i18n";
import { describe, expect, it } from "vitest";
import { problemCodeSchema } from "./schemas";
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [readFileSync(join(directory, entry.name), "utf8")]
        : [],
  );
}
describe("Bilingual contract catalogues", () => {
  it("keeps identical nonempty paths in both namespaces and covers every refusal", () => {
    for (const namespace of ["Contracts", "Approvals"] as const) {
      const english = paths(getMessages("en")[namespace]).sort();
      expect(paths(getMessages("ar")[namespace]).sort()).toEqual(english);
    }
    for (const locale of ["en", "ar"] as const)
      for (const code of problemCodeSchema.options)
        expect(
          getMessages(locale).Contracts.errors[code].length,
        ).toBeGreaterThan(0);
  });
  it("resolves every literal translation call used by contract screen components", () => {
    const directory = fileURLToPath(new URL("../_components", import.meta.url));
    const known = new Set([
      ...paths(getMessages("en").Contracts),
      ...paths(getMessages("en").Approvals),
    ]);
    for (const source of sources(directory))
      for (const match of source.matchAll(/\b(?:t|a|c)\("([\w.]+)"/g))
        expect(known.has(match[1] ?? "")).toBe(true);
  });
});
