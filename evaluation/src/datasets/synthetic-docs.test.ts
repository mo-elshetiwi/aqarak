import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { temporaryDirectory, writeSyntheticFixture } from "../test-fixtures";
import { loadSyntheticDocs, loadSplits, splitsSchema } from "./synthetic-docs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("loads all committed documents and the frozen screening and held-out splits", async () => {
  const directory = fileURLToPath(
    new URL("../../datasets/synthetic-docs-v1/", import.meta.url),
  );
  const documents = await loadSyntheticDocs(directory);
  const splits = await loadSplits(directory, documents);
  expect(documents).toHaveLength(120);
  expect(splits.screening).toHaveLength(30);
  expect(splits.held_out).toHaveLength(90);
  expect(splits).toMatchObject({
    dataset: "synthetic-docs-v1",
    seed: 20260928,
  });
  expect(new Set([...splits.screening, ...splits.held_out])).toEqual(
    new Set(documents.map((document) => document.doc_id)),
  );
  expect(splitsSchema.safeParse({ ...splits, unexpected: true }).success).toBe(
    false,
  );
  expect(splitsSchema.safeParse({ ...splits, seed: 1.5 }).success).toBe(false);
});
it("verifies ordered split hashes and rejects tampering", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  await writeSyntheticFixture(root);
  const documents = await loadSyntheticDocs(root);
  expect(documents).toHaveLength(3);
  expect((await loadSplits(root)).screening).toEqual([
    "doc-1",
    "doc-2",
    "doc-3",
  ]);
  const path = join(root, "splits.json");
  const valid = await loadSplits(root);
  await writeFile(
    path,
    JSON.stringify({ ...valid, screening: [...valid.screening].reverse() }),
  );
  await expect(loadSplits(root)).rejects.toThrow(
    "Synthetic split hash mismatch",
  );
});
it("rejects altered image bytes and label fields before screening", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  await writeSyntheticFixture(root);
  await writeFile(join(root, "doc-1.jpg"), "tampered");
  await expect(loadSyntheticDocs(root)).rejects.toThrow(
    "Synthetic image hash mismatch",
  );
  await writeSyntheticFixture(root);
  const path = join(root, "labels.jsonl");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      '"id_number":',
      '"unexpected_field":',
    ),
  );
  await expect(loadSyntheticDocs(root)).rejects.toThrow(
    "Invalid synthetic document labels",
  );
});
