/** Script-specific type roles preserve Arabic readability at mobile density. */
export const typeRoles = {
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
} as const;

/** Exact loaded family names avoid synthetic weights in React Native. */
export const fontFamilies = {
  latin: {
    "400": "IBMPlexSans_400Regular",
    "500": "IBMPlexSans_500Medium",
    "600": "IBMPlexSans_600SemiBold",
  },
  arabic: {
    "400": "IBMPlexSansArabic_400Regular",
    "500": "IBMPlexSansArabic_500Medium",
    "600": "IBMPlexSansArabic_600SemiBold",
  },
  mono: {
    "400": "IBMPlexMono_400Regular",
    "500": "IBMPlexMono_500Medium",
  },
} as const;
