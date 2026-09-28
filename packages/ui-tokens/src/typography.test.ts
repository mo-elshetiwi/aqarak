import { describe, it, expect } from "vitest";
import { typeRoles, fontFamilies } from "./typography";
const expected = {
  display: {
    latin: {
      sizePx: 32,
      lineHeightPx: 40,
      weight: 600,
    },
    arabic: {
      sizePx: 34,
      lineHeightPx: 52,
      weight: 600,
    },
  },
  h1: {
    latin: {
      sizePx: 24,
      lineHeightPx: 32,
      weight: 600,
    },
    arabic: {
      sizePx: 26,
      lineHeightPx: 40,
      weight: 600,
    },
  },
  h2: {
    latin: {
      sizePx: 20,
      lineHeightPx: 28,
      weight: 600,
    },
    arabic: {
      sizePx: 22,
      lineHeightPx: 36,
      weight: 600,
    },
  },
  h3: {
    latin: {
      sizePx: 16,
      lineHeightPx: 24,
      weight: 600,
    },
    arabic: {
      sizePx: 17,
      lineHeightPx: 28,
      weight: 600,
    },
  },
  body: {
    latin: {
      sizePx: 14,
      lineHeightPx: 20,
      weight: 400,
    },
    arabic: {
      sizePx: 15,
      lineHeightPx: 24,
      weight: 400,
    },
  },
  bodyStrong: {
    latin: {
      sizePx: 14,
      lineHeightPx: 20,
      weight: 500,
    },
    arabic: {
      sizePx: 15,
      lineHeightPx: 24,
      weight: 500,
    },
  },
  bodyLg: {
    latin: {
      sizePx: 16,
      lineHeightPx: 24,
      weight: 400,
    },
    arabic: {
      sizePx: 17,
      lineHeightPx: 28,
      weight: 400,
    },
  },
  label: {
    latin: {
      sizePx: 14,
      lineHeightPx: 20,
      weight: 500,
    },
    arabic: {
      sizePx: 15,
      lineHeightPx: 24,
      weight: 500,
    },
  },
  caption: {
    latin: {
      sizePx: 12,
      lineHeightPx: 16,
      weight: 400,
    },
    arabic: {
      sizePx: 13,
      lineHeightPx: 20,
      weight: 400,
    },
  },
  captionStrong: {
    latin: {
      sizePx: 12,
      lineHeightPx: 16,
      weight: 500,
    },
    arabic: {
      sizePx: 13,
      lineHeightPx: 20,
      weight: 500,
    },
  },
  mono: {
    latin: {
      sizePx: 13,
      lineHeightPx: 20,
      weight: 400,
    },
    arabic: {
      sizePx: 13,
      lineHeightPx: 20,
      weight: 400,
    },
  },
};
describe("AC-2 script-specific typography", () => {
  it("holds the exact tabled type roles", () => {
    expect(typeRoles).toEqual(expected);
  });
  it("keeps Arabic at least as large and respects minimum sizes", () => {
    for (const role of Object.values(typeRoles)) {
      expect(role.arabic.sizePx).toBeGreaterThanOrEqual(role.latin.sizePx);
      expect(role.latin.sizePx).toBeGreaterThanOrEqual(12);
      expect(role.arabic.sizePx).toBeGreaterThanOrEqual(13);
    }
  });
  it("gives Arabic reading roles at least 1.6 line height", () => {
    for (const key of ["body", "bodyStrong", "bodyLg", "label"] as const) {
      const role = typeRoles[key].arabic;
      expect(role.lineHeightPx / role.sizePx).toBeGreaterThanOrEqual(1.6);
    }
  });
  it("names each native font weight explicitly", () => {
    expect(fontFamilies.latin[600]).toBe("IBMPlexSans_600SemiBold");
    expect(fontFamilies.arabic[500]).toBe("IBMPlexSansArabic_500Medium");
    expect(fontFamilies.mono[400]).toBe("IBMPlexMono_400Regular");
  });
});
