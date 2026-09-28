import preset from "nativewind/preset";
import { colorTokens } from "@aqarak/ui-tokens/color";
const colors = Object.fromEntries(
  Object.keys(colorTokens.light).map((name) => {
    const key = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return [
      key,
      key === "overlay"
        ? "rgb(var(--overlay) / var(--overlay-alpha))"
        : `rgb(var(--${key}) / <alpha-value>)`,
    ];
  }),
);
export default {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [preset],
  theme: {
    extend: { colors, borderRadius: { lg: "12px", md: "8px", sm: "4px" } },
  },
  plugins: [],
};
