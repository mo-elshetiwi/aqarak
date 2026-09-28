import { describe, it, expect } from "vitest";
import { colorTokens, statusTones } from "./color";
import { colorTokens as webColors, type ColorTokenName } from "./index";
const expected = {
  light: {
    background: "#FBF8F2",
    foreground: "#121826",
    card: "#FFFFFF",
    cardForeground: "#121826",
    popover: "#FFFFFF",
    popoverForeground: "#121826",
    primary: "#121826",
    primaryForeground: "#FBF8F2",
    secondary: "#F1EBDF",
    secondaryForeground: "#121826",
    muted: "#F1EBDF",
    mutedForeground: "#6B6459",
    accent: "#F1EBDF",
    accentForeground: "#121826",
    destructive: "#B91C1C",
    destructiveForeground: "#FFFFFF",
    border: "#E4DCCB",
    input: "#8E8677",
    ring: "#B17D29",
    sidebar: "#F6F0E4",
    sidebarForeground: "#121826",
    sidebarAccent: "#FBF1DC",
    sidebarAccentForeground: "#845410",
    brand: "#996114",
    brandForeground: "#FFFFFF",
    brandSubtle: "#FBF1DC",
    overlay: "#0C0A0966",
    statusNeutralBg: "#F1EBDF",
    statusNeutralFg: "#44403C",
    statusNeutralBorder: "#E4DCCB",
    statusNeutralSolid: "#78716C",
    statusAttentionBg: "#FDF8E9",
    statusAttentionFg: "#92400E",
    statusAttentionBorder: "#FDE68A",
    statusAttentionSolid: "#D97706",
    statusProgressBg: "#F1F4F8",
    statusProgressFg: "#1E40AF",
    statusProgressBorder: "#BFDBFE",
    statusProgressSolid: "#2563EB",
    statusSuccessBg: "#F2FAF0",
    statusSuccessFg: "#166534",
    statusSuccessBorder: "#BBF7D0",
    statusSuccessSolid: "#16A34A",
    statusDangerBg: "#FCF2EE",
    statusDangerFg: "#991B1B",
    statusDangerBorder: "#FECACA",
    statusDangerSolid: "#DC2626",
    statusMutedBg: "#FBF8F2",
    statusMutedFg: "#78716C",
    statusMutedBorder: "#E4DCCB",
    statusMutedSolid: "#A8A29E",
    aiBg: "#F5F2F8",
    aiFg: "#5B21B6",
    aiBorder: "#DDD6FE",
  },
  dark: {
    background: "#121826",
    foreground: "#F6F0E4",
    card: "#1A2133",
    cardForeground: "#F6F0E4",
    popover: "#1A2133",
    popoverForeground: "#F6F0E4",
    primary: "#F6F0E4",
    primaryForeground: "#121826",
    secondary: "#242C40",
    secondaryForeground: "#F6F0E4",
    muted: "#242C40",
    mutedForeground: "#A9A395",
    accent: "#242C40",
    accentForeground: "#F6F0E4",
    destructive: "#F87171",
    destructiveForeground: "#1C1917",
    border: "#2A3348",
    input: "#646C83",
    ring: "#F1BE5E",
    sidebar: "#0E1420",
    sidebarForeground: "#F6F0E4",
    sidebarAccent: "#242C40",
    sidebarAccentForeground: "#FCE3A4",
    brand: "#EDC369",
    brandForeground: "#121826",
    brandSubtle: "#2A2A1F",
    overlay: "#00000099",
    statusNeutralBg: "#292524",
    statusNeutralFg: "#D6D3D1",
    statusNeutralBorder: "#44403C",
    statusNeutralSolid: "#A8A29E",
    statusAttentionBg: "#451A03",
    statusAttentionFg: "#FCD34D",
    statusAttentionBorder: "#78350F",
    statusAttentionSolid: "#F59E0B",
    statusProgressBg: "#172554",
    statusProgressFg: "#93C5FD",
    statusProgressBorder: "#1E3A8A",
    statusProgressSolid: "#3B82F6",
    statusSuccessBg: "#052E16",
    statusSuccessFg: "#86EFAC",
    statusSuccessBorder: "#14532D",
    statusSuccessSolid: "#22C55E",
    statusDangerBg: "#450A0A",
    statusDangerFg: "#FCA5A5",
    statusDangerBorder: "#7F1D1D",
    statusDangerSolid: "#EF4444",
    statusMutedBg: "#1C1917",
    statusMutedFg: "#A8A29E",
    statusMutedBorder: "#292524",
    statusMutedSolid: "#78716C",
    aiBg: "#2E1065",
    aiFg: "#C4B5FD",
    aiBorder: "#4C1D95",
  },
};
function luminance(hex: string): number {
  return [1, 3, 5].reduce((sum, start, index) => {
    const s = parseInt(hex.slice(start, start + 2), 16) / 255;
    const linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
  }, 0);
}
function contrast(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("AC-1 semantic colour contract", () => {
  it("holds the exact 54 names and tabled values in each scheme", () => {
    expect(colorTokens).toEqual(expected);
    for (const colors of Object.values(colorTokens)) {
      expect(Object.keys(colors)).toHaveLength(54);
      for (const value of Object.values(colors))
        expect(value).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
    }
    expect(Object.keys(colorTokens.light)).toEqual(
      Object.keys(colorTokens.dark),
    );
  });
  it.each(["light", "dark"] as const)(
    "meets text and control contrast in %s",
    (scheme) => {
      const c = colorTokens[scheme];
      const pairs: [string, string][] = [
        [c.foreground, c.background],
        [c.cardForeground, c.card],
        [c.popoverForeground, c.popover],
        [c.mutedForeground, c.background],
        [c.primaryForeground, c.primary],
        [c.aiFg, c.aiBg],
      ];
      for (const tone of [
        "Neutral",
        "Attention",
        "Progress",
        "Success",
        "Danger",
        "Muted",
      ] as const)
        pairs.push([c[`status${tone}Fg`], c[`status${tone}Bg`]]);
      for (const [fg, bg] of pairs) {
        if (fg && bg) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(c.mutedForeground, c.muted)).toBeGreaterThanOrEqual(4.5);
      for (const fg of [c.input, c.ring])
        expect(contrast(fg, c.background)).toBeGreaterThanOrEqual(3);
    },
  );
  it("shares six status tones", () => {
    expect(statusTones).toEqual([
      "neutral",
      "attention",
      "progress",
      "success",
      "danger",
      "muted",
    ]);
  });
});

it.each(["light", "dark"] as const)(
  "keeps native roles aligned with web in %s",
  (theme) => {
    for (const [name, value] of Object.entries(colorTokens[theme])) {
      if (name === "overlay") continue;
      const webName = name.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`,
      ) as ColorTokenName;
      expect(webColors[theme][webName], name).toBe(value);
    }
  },
);
