import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
function bytes(path: string): Buffer {
  return readFileSync(new URL(path, root));
}

describe("brand assets", () => {
  it.each([
    ["ink", "c6a9756b4176b1e6ddaf4d93dae173f7d29877f3ae08e3fea183723c2122d08d"],
    [
      "cream",
      "d2151cd3f8e78168973320501ec685d3de99771ec096c1fa8e8064b4f0d802b5",
    ],
  ])("preserves the supplied %s source byte for byte", (variant, digest) => {
    expect(
      createHash("sha256")
        .update(bytes(`apps/web/public/brand/aqarak-icon-${variant}.svg`))
        .digest("hex"),
    ).toBe(digest);
  });

  it("uses the ink source as the vector favicon", () => {
    expect(bytes("apps/web/public/favicon.svg")).toEqual(
      bytes("apps/web/public/brand/aqarak-icon-ink.svg"),
    );
  });

  it.each([
    ["apps/web/public/icon-32.png", 32],
    ["apps/web/public/apple-touch-icon.png", 180],
    ["apps/mobile/assets/icon.png", 1024],
    ["apps/mobile/assets/adaptive-icon.png", 1080],
    ["apps/mobile/assets/splash.png", 512],
  ] as const)("provides a square PNG at %s with %s pixels", (path, size) => {
    const file = bytes(path);
    expect(file.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(file.toString("ascii", 12, 16)).toBe("IHDR");
    expect(file.readUInt32BE(16)).toBe(size);
    expect(file.readUInt32BE(20)).toBe(size);
  });

  it("resolves the configured mobile icon, adaptive foreground and centred splash", () => {
    const config = JSON.parse(
      bytes("apps/mobile/app.json").toString("utf8"),
    ) as {
      expo: {
        icon: string;
        android: {
          adaptiveIcon: { foregroundImage: string; backgroundColor: string };
        };
        plugins: (string | [string, Record<string, unknown>])[];
      };
    };
    const adaptive = config.expo.android.adaptiveIcon;
    const splash = config.expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    );
    expect(Array.isArray(splash)).toBe(true);
    if (!Array.isArray(splash)) throw new Error("Missing splash configuration");
    expect(splash[1]).toMatchObject({
      backgroundColor: "#121826",
    });
    expect(adaptive.backgroundColor).toBe("#121826");
    for (const path of [
      config.expo.icon,
      adaptive.foregroundImage,
      splash[1].image,
    ]) {
      expect(typeof path).toBe("string");
      if (typeof path !== "string") throw new Error("Missing asset path");
      expect(bytes(`apps/mobile/${path}`).length).toBeGreaterThan(0);
    }
  });
});
