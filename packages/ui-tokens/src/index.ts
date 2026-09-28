/** Base increment used by spacing scales in both renderers. */
export const spaceUnitPx = 4 as const;
/** Corner radii from compact surfaces to fully rounded controls. */
export const radiusPx = { sm: 4, md: 8, lg: 12, full: 9999 } as const;
/** Durations for short and standard interface transitions. */
export const motionDurationMs = { fast: 150, standard: 180 } as const;
/** Ascending interface type sizes in CSS pixels. */
export const typeScalePx = [12, 13, 14, 16, 20, 24, 32] as const;
/** Reading line heights for Latin and Arabic text. */
export const lineHeight = { latin: 1.5, arabic: 1.7 } as const;
/** Platform minimums and the default web interaction target size. */
export const minimumTargetSize = {
  webCssPx: 24,
  webDefaultCssPx: 36,
  iosPt: 44,
  androidDp: 48,
} as const;
/** Interface typefaces selected for the two writing systems. */
export const fontFamily = {
  uiLatin: "IBM Plex Sans",
  uiArabic: "IBM Plex Sans Arabic",
  mono: "IBM Plex Mono",
} as const;

const light = {
  background: "#FBF8F2",
  foreground: "#121826",
  card: "#FFFFFF",
  "card-foreground": "#121826",
  popover: "#FFFFFF",
  "popover-foreground": "#121826",
  primary: "#121826",
  "primary-foreground": "#FBF8F2",
  secondary: "#F1EBDF",
  "secondary-foreground": "#121826",
  muted: "#F1EBDF",
  "muted-foreground": "#6B6459",
  accent: "#F1EBDF",
  "accent-foreground": "#121826",
  destructive: "#B91C1C",
  "destructive-foreground": "#FFFFFF",
  border: "#E4DCCB",
  input: "#8E8677",
  ring: "#B17D29",
  sidebar: "#F6F0E4",
  "sidebar-foreground": "#121826",
  "sidebar-accent": "#FBF1DC",
  "sidebar-accent-foreground": "#845410",
  brand: "#996114",
  "brand-foreground": "#FFFFFF",
  "brand-subtle": "#FBF1DC",
  "ai-bg": "#F5F2F8",
  "ai-fg": "#5B21B6",
  "ai-border": "#DDD6FE",
  "confidence-confirm-fg": "#92400E",
  "confidence-confirm-bg": "#FDF8E9",
  "confidence-confirm-border": "#F59E0B",
  "confidence-check-fg": "#5B21B6",
  "confidence-check-bg": "#F5F2F8",
  "confidence-suggested-fg": "#44403C",
  "confidence-suggested-bg": "#F1EBDF",
  overlay: "rgba(12, 10, 9, 0.4)",
  "status-neutral-bg": "#F1EBDF",
  "status-neutral-fg": "#44403C",
  "status-neutral-border": "#E4DCCB",
  "status-neutral-solid": "#78716C",
  "status-attention-bg": "#FDF8E9",
  "status-attention-fg": "#92400E",
  "status-attention-border": "#FDE68A",
  "status-attention-solid": "#D97706",
  "status-progress-bg": "#F1F4F8",
  "status-progress-fg": "#1E40AF",
  "status-progress-border": "#BFDBFE",
  "status-progress-solid": "#2563EB",
  "status-success-bg": "#F2FAF0",
  "status-success-fg": "#166534",
  "status-success-border": "#BBF7D0",
  "status-success-solid": "#16A34A",
  "status-danger-bg": "#FCF2EE",
  "status-danger-fg": "#991B1B",
  "status-danger-border": "#FECACA",
  "status-danger-solid": "#DC2626",
  "status-muted-bg": "#FBF8F2",
  "status-muted-fg": "#78716C",
  "status-muted-border": "#E4DCCB",
  "status-muted-solid": "#A8A29E",
} as const;

/** Semantic colour roles shared by both renderers. */
export type ColorTokenName = keyof typeof light;
export const colorTokens: {
  light: Record<ColorTokenName, string>;
  dark: Record<ColorTokenName, string>;
} = {
  light,
  dark: {
    background: "#121826",
    foreground: "#F6F0E4",
    card: "#1A2133",
    "card-foreground": "#F6F0E4",
    popover: "#1A2133",
    "popover-foreground": "#F6F0E4",
    primary: "#F6F0E4",
    "primary-foreground": "#121826",
    secondary: "#242C40",
    "secondary-foreground": "#F6F0E4",
    muted: "#242C40",
    "muted-foreground": "#A9A395",
    accent: "#242C40",
    "accent-foreground": "#F6F0E4",
    destructive: "#F87171",
    "destructive-foreground": "#1C1917",
    border: "#2A3348",
    input: "#646C83",
    ring: "#F1BE5E",
    sidebar: "#0E1420",
    "sidebar-foreground": "#F6F0E4",
    "sidebar-accent": "#242C40",
    "sidebar-accent-foreground": "#FCE3A4",
    brand: "#EDC369",
    "brand-foreground": "#121826",
    "brand-subtle": "#2A2A1F",
    "ai-bg": "#2E1065",
    "ai-fg": "#C4B5FD",
    "ai-border": "#4C1D95",
    "confidence-confirm-fg": "#FCD34D",
    "confidence-confirm-bg": "#451A03",
    "confidence-confirm-border": "#F59E0B",
    "confidence-check-fg": "#C4B5FD",
    "confidence-check-bg": "#2E1065",
    "confidence-suggested-fg": "#D6D3D1",
    "confidence-suggested-bg": "#292524",
    overlay: "rgba(0, 0, 0, 0.6)",
    "status-neutral-bg": "#292524",
    "status-neutral-fg": "#D6D3D1",
    "status-neutral-border": "#44403C",
    "status-neutral-solid": "#A8A29E",
    "status-attention-bg": "#451A03",
    "status-attention-fg": "#FCD34D",
    "status-attention-border": "#78350F",
    "status-attention-solid": "#F59E0B",
    "status-progress-bg": "#172554",
    "status-progress-fg": "#93C5FD",
    "status-progress-border": "#1E3A8A",
    "status-progress-solid": "#3B82F6",
    "status-success-bg": "#052E16",
    "status-success-fg": "#86EFAC",
    "status-success-border": "#14532D",
    "status-success-solid": "#22C55E",
    "status-danger-bg": "#450A0A",
    "status-danger-fg": "#FCA5A5",
    "status-danger-border": "#7F1D1D",
    "status-danger-solid": "#EF4444",
    "status-muted-bg": "#1C1917",
    "status-muted-fg": "#A8A29E",
    "status-muted-border": "#292524",
    "status-muted-solid": "#78716C",
  },
};
export const statusTones = {
  neutral: {
    icon: "circle-dashed",
    bg: "status-neutral-bg",
    fg: "status-neutral-fg",
    border: "status-neutral-border",
    solid: "status-neutral-solid",
  },
  attention: {
    icon: "clock",
    bg: "status-attention-bg",
    fg: "status-attention-fg",
    border: "status-attention-border",
    solid: "status-attention-solid",
  },
  progress: {
    icon: "contrast",
    bg: "status-progress-bg",
    fg: "status-progress-fg",
    border: "status-progress-border",
    solid: "status-progress-solid",
  },
  success: {
    icon: "circle-check",
    bg: "status-success-bg",
    fg: "status-success-fg",
    border: "status-success-border",
    solid: "status-success-solid",
  },
  danger: {
    icon: "triangle-alert",
    bg: "status-danger-bg",
    fg: "status-danger-fg",
    border: "status-danger-border",
    solid: "status-danger-solid",
  },
  muted: {
    icon: "circle-minus",
    bg: "status-muted-bg",
    fg: "status-muted-fg",
    border: "status-muted-border",
    solid: "status-muted-solid",
  },
} as const;
export const chartPalette = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#E69F00",
  "#56B4E9",
  "#CC79A7",
  "#F0E442",
] as const;
export const typeScale = {
  latin: {
    display: {
      size: 32,
      lineHeight: 40,
      weight: 600,
    },
    h1: {
      size: 24,
      lineHeight: 32,
      weight: 600,
    },
    h2: {
      size: 20,
      lineHeight: 28,
      weight: 600,
    },
    h3: {
      size: 16,
      lineHeight: 24,
      weight: 600,
    },
    body: {
      size: 16,
      lineHeight: 24,
      weight: 400,
    },
    "body-dense": {
      size: 14,
      lineHeight: 20,
      weight: 400,
    },
    "body-strong": {
      size: 16,
      lineHeight: 24,
      weight: 500,
    },
    label: {
      size: 14,
      lineHeight: 20,
      weight: 500,
    },
    caption: {
      size: 12,
      lineHeight: 16,
      weight: 400,
    },
    "caption-strong": {
      size: 12,
      lineHeight: 16,
      weight: 500,
    },
    mono: {
      size: 13,
      lineHeight: 20,
      weight: 400,
    },
  },
  arabic: {
    display: {
      size: 34,
      lineHeight: 56,
      weight: 600,
    },
    h1: {
      size: 26,
      lineHeight: 42,
      weight: 600,
    },
    h2: {
      size: 22,
      lineHeight: 36,
      weight: 600,
    },
    h3: {
      size: 17,
      lineHeight: 28,
      weight: 600,
    },
    body: {
      size: 16,
      lineHeight: 26,
      weight: 400,
    },
    "body-dense": {
      size: 16,
      lineHeight: 26,
      weight: 400,
    },
    "body-strong": {
      size: 16,
      lineHeight: 26,
      weight: 500,
    },
    label: {
      size: 15,
      lineHeight: 24,
      weight: 500,
    },
    caption: {
      size: 13,
      lineHeight: 21,
      weight: 400,
    },
    "caption-strong": {
      size: 13,
      lineHeight: 21,
      weight: 500,
    },
    mono: {
      size: 13,
      lineHeight: 20,
      weight: 400,
    },
  },
} as const;
export const elevation = {
  light: {
    0: "none",
    1: "0 1px 2px rgba(12,10,9,0.06)",
    2: "0 4px 12px -2px rgba(12,10,9,0.10), 0 2px 4px -2px rgba(12,10,9,0.06)",
    3: "0 16px 40px -8px rgba(12,10,9,0.20)",
  },
  dark: {
    0: "none",
    1: "0 1px 2px rgba(0,0,0,0.4)",
    2: "0 4px 12px -2px rgba(0,0,0,0.5)",
    3: "0 16px 40px -8px rgba(0,0,0,0.6)",
  },
} as const;
export const easing = { standard: "cubic-bezier(0.2, 0, 0, 1)" } as const;

function themeProperties(theme: "light" | "dark"): string {
  const colours = Object.entries(colorTokens[theme]).map(
    ([name, value]) => `  --${name}: ${value.toLowerCase()};`,
  );
  const shadows = Object.entries(elevation[theme]).map(([level, value]) => {
    const formatted = value
      .replace(/,(?=\S)/g, ", ")
      .replace(/0\.10/g, "0.1")
      .replace(/0\.20/g, "0.2");
    return theme === "light" && level === "2"
      ? `  --elevation-${level}:\n    ${formatted};`
      : `  --elevation-${level}: ${formatted};`;
  });
  return [...colours, ...shadows].join("\n");
}
/** Produces deterministic CSS from the shared colour and geometry contract. */
export function renderTokenCss(): string {
  const aliases = {
    "sidebar-border": "border",
    "sidebar-ring": "ring",
    "sidebar-primary": "brand",
    "sidebar-primary-foreground": "brand-foreground",
  };
  const scales: Readonly<
    Record<
      string,
      Readonly<
        Record<string, { size: number; lineHeight: number; weight: number }>
      >
    >
  > = typeScale;
  const shared = [
    ...Object.entries(aliases).map(
      ([name, value]) => `  --${name}: var(--${value});`,
    ),
    ...chartPalette.map(
      (value, index) =>
        `  --chart-${String(index + 1)}: ${value.toLowerCase()};`,
    ),
    `  --radius: ${String(radiusPx.lg)}px;`,
    ...Object.entries(radiusPx).map(
      ([name, value]) => `  --corner-${name}: ${String(value)}px;`,
    ),
    ...Object.entries(motionDurationMs).map(
      ([name, value]) => `  --motion-${name}: ${String(value)}ms;`,
    ),
    `  --motion-easing: ${easing.standard};`,
    ...Object.entries(scales).flatMap(([script, scale]) =>
      Object.entries(scale).flatMap(([name, value]) => [
        `  --type-${script}-${name}-size: ${String(value.size)}px;`,
        `  --type-${script}-${name}-line-height: ${String(value.lineHeight)}px;`,
        `  --type-${script}-${name}-weight: ${String(value.weight)};`,
      ]),
    ),
  ].join("\n");
  return `:root {\n${themeProperties("light")}\n${shared}\n}\n\n.dark {\n${themeProperties("dark")}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root:not(.light) {\n${themeProperties(
    "dark",
  )
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n  }\n}\n`;
}
/** WCAG relative luminance contrast for opaque six-digit sRGB colours. */
export function contrastRatio(foreground: string, background: string): number {
  function luminance(hex: string): number {
    if (!/^#[0-9a-f]{6}$/i.test(hex))
      throw new TypeError("Expected an opaque six-digit hex colour");
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return (
      (channels[0] ?? 0) * 0.2126 +
      (channels[1] ?? 0) * 0.7152 +
      (channels[2] ?? 0) * 0.0722
    );
  }
  const first = luminance(foreground),
    second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
export { typeRoles, fontFamilies } from "./typography";
