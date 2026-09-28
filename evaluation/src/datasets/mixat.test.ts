import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { temporaryDirectory } from "../test-fixtures";
import { loadMixat } from "./mixat";

const label = {
  id: "clip-1",
  part: 1,
  file: "audio/clip-1.wav",
  split: "screening",
  language: "ar",
  duration_ms: 1000,
  transcript: "synthetic transcript placeholder",
} as const;
const extraFields = {
  source_repo: "synthetic-repository",
  source_rev: "synthetic-revision",
  source_shard: "synthetic-shard",
  source_row_group: 0,
  transliteration: "synthetic transliteration placeholder",
  translation: "synthetic translation placeholder",
  unexpected: "synthetic extra field",
} as const;
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function writeFixture(
  labels: readonly Readonly<Record<string, unknown>>[],
  screeningIds: readonly string[] = [label.id],
): Promise<string> {
  const root = await temporaryDirectory();
  roots.push(root);
  const directory = join(root, "mixat");
  await mkdir(directory);
  await writeFile(
    join(directory, "labels.jsonl"),
    labels.map((item) => JSON.stringify(item)).join("\n") + "\n",
  );
  await writeFile(
    join(directory, "screening_ids.txt"),
    screeningIds.join("\n") + "\n",
  );
  await writeFile(join(directory, "manifest.json"), "{}");
  return root;
}

it("loads documented metadata and returns exactly the seven label fields", async () => {
  const secondLabel = { ...label, id: "clip-2", part: "synthetic-part" };
  const root = await writeFixture([
    { ...label, ...extraFields },
    { ...secondLabel, ...extraFields },
  ]);
  const dataset = await loadMixat(root);
  expect(dataset.labels).toStrictEqual([label, secondLabel]);
  expect(dataset.screeningIds).toEqual([label.id]);
});

it.each([
  ["missing transcript", { ...label, transcript: undefined }],
  ["invalid id", { ...label, id: 1 }],
  ["invalid part", { ...label, part: false }],
  ["invalid file", { ...label, file: 1 }],
  ["invalid split", { ...label, split: 1 }],
  ["invalid language", { ...label, language: 1 }],
  ["invalid duration", { ...label, duration_ms: "1000" }],
  ["invalid transcript", { ...label, transcript: 1 }],
] as const)("rejects %s despite extra metadata", async (_name, invalid) => {
  const root = await writeFixture([{ ...invalid, ...extraFields }]);
  await expect(loadMixat(root)).rejects.toThrow("Invalid speech labels");
});

it("rejects duplicate label ids despite extra metadata", async () => {
  const item = { ...label, ...extraFields };
  const root = await writeFixture([item, item]);
  await expect(loadMixat(root)).rejects.toThrow("Invalid speech labels");
});

it("rejects an audio path outside the dataset", async () => {
  const root = await writeFixture([
    { ...label, ...extraFields, file: "../outside.wav" },
  ]);
  await expect(loadMixat(root)).rejects.toThrow("Dataset path leaves its root");
});

it.each([["clip-1", "clip-1"], ["missing-clip"]])(
  "rejects invalid screening ids %j",
  async (...screeningIds) => {
    const root = await writeFixture(
      [{ ...label, ...extraFields }],
      screeningIds,
    );
    await expect(loadMixat(root)).rejects.toThrow(
      "Invalid speech screening ids",
    );
  },
);
