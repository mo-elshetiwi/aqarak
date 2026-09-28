import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colorTokens,
  contrastRatio,
  renderTokenCss,
  typeScale,
  motionDurationMs,
} from "./index";

import {
  textPairs,
  nonTextPairs,
  renderContrastTable,
  renderPaletteTable,
} from "./contrast-contract";

describe("generated token contract", () => {
  it("matches the committed CSS in all three theme blocks", () => {
    const css = renderTokenCss();
    expect(
      readFileSync(new URL("../tokens.css", import.meta.url), "utf8"),
    ).toBe(css);
    expect(css).toContain(":root {");
    expect(css).toContain(".dark {");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(":root:not(.light)");
    for (const name of Object.keys(colorTokens.light)) {
      expect(css.split(`--${name}:`).length - 1).toBe(3);
    }
  });
  it("keeps motion and Arabic body metrics within the contract", () => {
    expect(motionDurationMs).toEqual({ fast: 150, standard: 180 });
    for (const key of ["body", "body-dense", "body-strong"] as const) {
      expect(typeScale.arabic[key].size).toBeGreaterThanOrEqual(16);
      expect(
        typeScale.arabic[key].lineHeight / typeScale.arabic[key].size,
      ).toBeGreaterThanOrEqual(1.6);
    }
  });
});
for (const theme of ["light", "dark"] as const) {
  describe(`${theme} WCAG contrast`, () => {
    it.each(textPairs)("%s on %s meets 4.5:1", (fg, bg) => {
      expect(
        contrastRatio(colorTokens[theme][fg], colorTokens[theme][bg]),
      ).toBeGreaterThanOrEqual(4.5);
    });
    it.each(nonTextPairs)("%s on %s meets non-text 3:1", (fg, bg) => {
      expect(
        contrastRatio(colorTokens[theme][fg], colorTokens[theme][bg]),
      ).toBeGreaterThanOrEqual(3);
    });
  });
}
it("keeps the design specification in sync with the measured contrast and palette", () => {
  const document = readFileSync(
    new URL("../../../docs/design/brand-palette.md", import.meta.url),
    "utf8",
  );
  expect(document).toContain(renderContrastTable());
  expect(document).toContain(renderPaletteTable());
});

it("computes known luminance extremes and rejects translucent input", () => {
  expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
  expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
  expect(() => contrastRatio("transparent", "#FFFFFF")).toThrow(TypeError);
});
