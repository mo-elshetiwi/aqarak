import {
  colorTokens,
  contrastRatio,
  statusTones,
  type ColorTokenName,
} from "./index";

type ContrastPair = readonly [ColorTokenName, ColorTokenName];

/** I cover text on its actual surfaces, including the sign-in sidebar. */
export const textPairs: readonly ContrastPair[] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "sidebar"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive", "background"],
  ["destructive-foreground", "destructive"],
  ["brand", "background"],
  ["brand", "card"],
  ["brand", "sidebar"],
  ["brand", "brand-subtle"],
  ["brand-foreground", "brand"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["ai-fg", "ai-bg"],
  ["confidence-confirm-fg", "confidence-confirm-bg"],
  ["confidence-check-fg", "confidence-check-bg"],
  ["confidence-suggested-fg", "confidence-suggested-bg"],
  ...Object.values(statusTones).map<ContrastPair>((tone) => [tone.fg, tone.bg]),
];

/** I measure control edges and focus rings against their adjacent surfaces. */
export const nonTextPairs: readonly ContrastPair[] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["ring", "card"],
  ["ring", "muted"],
  ["ring", "sidebar"],
];

/** I use the same unrounded measurements for assertions and the colour report. */
export function contrastRows(): {
  foreground: ColorTokenName;
  background: ColorTokenName;
  minimum: number;
  light: number;
  dark: number;
}[] {
  return [
    ...textPairs.map(([foreground, background]) => ({
      foreground,
      background,
      minimum: 4.5,
    })),
    ...nonTextPairs.map(([foreground, background]) => ({
      foreground,
      background,
      minimum: 3,
    })),
  ].map((pair) => ({
    ...pair,
    light: contrastRatio(
      colorTokens.light[pair.foreground],
      colorTokens.light[pair.background],
    ),
    dark: contrastRatio(
      colorTokens.dark[pair.foreground],
      colorTokens.dark[pair.background],
    ),
  }));
}

function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, index) =>
    Math.max(3, header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  function line(row: readonly string[]): string {
    return `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 3)).join(" | ")} |`;
  }
  return [
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
  ].join("\n");
}

export function renderContrastTable(): string {
  return renderTable(
    ["Foreground", "Surface", "Minimum", "Light", "Dark"],
    contrastRows().map((row) => [
      row.foreground,
      row.background,
      `${String(row.minimum)}:1`,
      `${row.light.toFixed(3)}:1`,
      `${row.dark.toFixed(3)}:1`,
    ]),
  );
}

export function renderPaletteTable(): string {
  return renderTable(
    ["Token", "Light", "Dark"],
    Object.entries(colorTokens.light).map(([name, value]) => [
      name,
      value,
      colorTokens.dark[name as ColorTokenName],
    ]),
  );
}
