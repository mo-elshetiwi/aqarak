import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
it("uses semantic colour tokens throughout the web source", () => {
  const raw =
    /#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch)a?\s*\(|(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|divide|decoration|accent|caret)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\b|\/)/gi;
  const violations = sources(new URL("../", import.meta.url).pathname).flatMap(
    (file) =>
      [...readFileSync(file, "utf8").matchAll(raw)].map(
        (match) => `${file}: ${match[0]}`,
      ),
  );
  expect(violations).toEqual([]);
});
