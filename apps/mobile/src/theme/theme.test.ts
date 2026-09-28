import { colorTokens } from "@aqarak/ui-tokens/color";
import { themeVariables, utilityName } from "./colors";
import { textStyle } from "./typography";
import fs from "node:fs";
import path from "node:path";
function files(folder: string): string[] {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(folder, entry.name))
        : [path.join(folder, entry.name)],
    );
}
describe("AC-3 token-backed mobile theme", () => {
  it.each(["light", "dark"] as const)(
    "maps every colour utility to shared %s RGB values",
    (scheme) => {
      const vars = themeVariables(scheme);
      for (const [name, value] of Object.entries(colorTokens[scheme])) {
        const channels = [1, 3, 5]
          .map((i) => parseInt(value.slice(i, i + 2), 16))
          .join(" ");
        expect(vars[`--${utilityName(name)}`]).toBe(channels);
      }
      expect(Object.keys(vars)).toHaveLength(55);
    },
  );
  it.each([
    ["light", "0.4"],
    ["dark", "0.6"],
  ] as const)("D03 preserves the %s overlay alpha", (scheme, alpha) => {
    expect(themeVariables(scheme)["--overlay-alpha"]).toBe(alpha);
  });
  it("contains no raw colours in components or routes", () => {
    const root = path.resolve(__dirname, "..");
    const raw =
      /(#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?:color|backgroundColor|borderColor)\s*:\s*["'](?:black|white|red|blue|green|transparent)["']|(?:bg|text|border|shadow)-(?:white|black))/i;
    for (const file of [
      ...files(path.join(root, "components")),
      ...files(path.join(root, "app")),
    ])
      expect({
        file,
        match: raw.exec(fs.readFileSync(file, "utf8"))?.[0],
      }).toEqual({ file, match: undefined });
  });
  it("uses left as reading start in both locales because native RTL mirrors alignment", () => {
    expect(textStyle("ar", "h1")).toMatchObject({
      textAlign: "left",
      fontFamily: "IBMPlexSansArabic_600SemiBold",
      fontSize: 26,
      lineHeight: 40,
    });
    expect(textStyle("en", "bodyLg").textAlign).toBe("left");
  });
});
