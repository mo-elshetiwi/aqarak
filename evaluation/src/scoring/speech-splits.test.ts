import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const entry = z.tuple([
  z.string().min(1),
  sha256,
  z.enum(["Arabic", "CS", "English", "ar_eg", "en_us"]),
]);
const schema = z
  .object({
    dataset: z.literal("speech-splits-v1"),
    rule: z.string().min(1),
    sources: z
      .array(
        z
          .object({
            name: z.string(),
            source_url: z.union([z.string(), z.array(z.string())]),
            revision: z.union([z.string(), z.record(z.string(), z.string())]),
            licence: z.string(),
            manifest_sha256: sha256,
          })
          .strict(),
      )
      .length(2),
    screening: z.array(entry),
    held_out: z.array(entry),
    screening_sha256: sha256,
    held_out_sha256: sha256,
  })
  .strict();

function readSplit(): z.infer<typeof schema> {
  return schema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../datasets/speech-splits-v1.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

function hashEntries(
  entries: readonly (readonly [string, string, string])[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(entries.map(([id, audioHash]) => [id, audioHash])))
    .digest("hex");
}

describe("frozen speech splits", () => {
  it("contains 50 screening and 400 held-out entries with disjoint ids", () => {
    const split = readSplit();
    expect(split.screening).toHaveLength(50);
    expect(split.held_out).toHaveLength(400);
    const screeningIds = new Set(split.screening.map(([id]) => id));
    expect(screeningIds.size).toBe(50);
    expect(new Set(split.held_out.map(([id]) => id)).size).toBe(400);
    expect(split.held_out.some(([id]) => screeningIds.has(id))).toBe(false);
  });
  it("recomputes both frozen split hashes from ordered id and audio-hash pairs", () => {
    const split = readSplit();
    expect(hashEntries(split.screening)).toBe(split.screening_sha256);
    expect(hashEntries(split.held_out)).toBe(split.held_out_sha256);
    for (const entries of [split.screening, split.held_out]) {
      const ids = entries.map(([id]) => id);
      expect(ids).toEqual([...ids].sort());
    }
  });
  it("preserves the MIXAT split and both FLEURS regression languages", () => {
    const split = readSplit();
    expect(
      split.screening.every(([, , language]) =>
        ["Arabic", "CS", "English"].includes(language),
      ),
    ).toBe(true);
    expect(
      split.held_out.filter(([, , language]) => language === "ar_eg"),
    ).toHaveLength(100);
    expect(
      split.held_out.filter(([, , language]) => language === "en_us"),
    ).toHaveLength(100);
    expect(
      split.held_out.filter(([, , language]) =>
        ["Arabic", "CS", "English"].includes(language),
      ),
    ).toHaveLength(200);
    expect(split.sources.map((source) => source.name)).toEqual([
      "mixat",
      "fleurs",
    ]);
  });
});
