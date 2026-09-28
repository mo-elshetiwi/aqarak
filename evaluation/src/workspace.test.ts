import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";

describe("evaluation workspace", () => {
  it("registers a private module with the screening command", () => {
    const result = z
      .object({
        name: z.string(),
        private: z.literal(true),
        type: z.literal("module"),
        scripts: z.object({ screen: z.string() }),
      })
      .safeParse(
        JSON.parse(
          readFileSync(new URL("../package.json", import.meta.url), "utf8"),
        ),
      );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.scripts.screen).toBe("tsx src/cli/screen.ts");
  });
});
