import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256Hex } from "@aqarak/api/models";
import { safeIdSchema, containedPath } from "../paths";
export const mixatLabelSchema = z
  .object({
    id: safeIdSchema,
    part: z.union([z.string(), z.number().int()]),
    file: z.string(),
    split: z.string(),
    language: z.string(),
    duration_ms: z.number().nonnegative(),
    transcript: z.string(),
  })
  .readonly();
export type MixatLabel = z.infer<typeof mixatLabelSchema>;
export interface MixatDataset {
  readonly directory: string;
  readonly labels: readonly MixatLabel[];
  readonly screeningIds: readonly string[];
  readonly manifestSha256: string;
  readonly splitSha256: string;
}
/** Load non-commercial speech metadata without writing content to the repository. */
export async function loadMixat(dataDir: string): Promise<MixatDataset> {
  const directory = join(dataDir, "mixat");
  const labels: MixatLabel[] = [];
  const ids = new Set<string>();
  for (const line of (await readFile(join(directory, "labels.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")) {
    const parsed = mixatLabelSchema.safeParse(JSON.parse(line));
    if (!parsed.success || ids.has(parsed.data.id))
      throw new Error("Invalid speech labels");
    containedPath(directory, parsed.data.file);
    labels.push(parsed.data);
    ids.add(parsed.data.id);
  }
  const splitBytes = await readFile(join(directory, "screening_ids.txt"));
  const screeningIds = splitBytes
    .toString("utf8")
    .split(/\r?\n/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (
    new Set(screeningIds).size !== screeningIds.length ||
    screeningIds.some((id) => !ids.has(id))
  )
    throw new Error("Invalid speech screening ids");
  return {
    directory,
    labels,
    screeningIds,
    manifestSha256: sha256Hex(await readFile(join(directory, "manifest.json"))),
    splitSha256: sha256Hex(splitBytes),
  };
}
