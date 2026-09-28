import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  documentKindSchema,
  fieldTypeSchema,
  DOCUMENT_FIELD_CATALOGUE,
  sha256Hex,
} from "@aqarak/api/models";
import { containedPath, safeIdSchema } from "../paths";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const boxSchema = z
  .union([
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
    z.record(z.string(), z.number()),
  ])
  .nullable();
const labelFieldSchema = z.strictObject({
  type: fieldTypeSchema,
  script: z.string(),
  condition: z.enum(["readable", "absent", "occluded", "distractor"]),
  value: z.string().nullable(),
  true_value: z.string().nullable(),
  printed: z.string().nullable(),
  render_box: boxSchema,
  image_box: boxSchema,
  decoy: z
    .strictObject({
      label_en: z.string(),
      label_ar: z.string(),
      printed: z.string(),
      value: z.string(),
      image_box: boxSchema,
    })
    .nullable(),
});
export const syntheticDocumentSchema = z
  .strictObject({
    doc_id: safeIdSchema,
    kind: documentKindSchema,
    synthetic: z.literal(true),
    generator_version: z.string(),
    seed: z.number().int(),
    layout_family: z.string(),
    image: z.string(),
    image_sha256: hash,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    capture: z.record(z.string(), z.json()),
    fields: z.record(z.string(), labelFieldSchema),
    render_check: z.record(z.string(), z.json()),
  })
  .superRefine((document, context) => {
    const catalogue = DOCUMENT_FIELD_CATALOGUE[document.kind];
    if (
      Object.keys(document.fields).length !== catalogue.length ||
      catalogue.some(
        (field) => document.fields[field.name]?.type !== field.type,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Document fields differ from the catalogue",
      });
  })
  .readonly();
export type SyntheticDocument = z.infer<typeof syntheticDocumentSchema>;
export const splitsSchema = z
  .strictObject({
    dataset: z.string(),
    seed: z.number().int(),
    rule: z.string(),
    screening: z.array(safeIdSchema),
    held_out: z.array(safeIdSchema),
    screening_sha256: hash,
    held_out_sha256: hash,
  })
  .readonly();
export type DatasetSplits = z.infer<typeof splitsSchema>;
/** Load synthetic labels and verify each referenced image before screening. */
export async function loadSyntheticDocs(
  directory: string,
): Promise<readonly SyntheticDocument[]> {
  const text = await readFile(join(directory, "labels.jsonl"), "utf8");
  const documents: SyntheticDocument[] = [];
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/).filter((line) => line.trim() !== "")) {
    const parsed = syntheticDocumentSchema.safeParse(JSON.parse(line));
    if (!parsed.success || ids.has(parsed.data.doc_id))
      throw new Error("Invalid synthetic document labels");
    ids.add(parsed.data.doc_id);
    const bytes = await readFile(containedPath(directory, parsed.data.image));
    if (sha256Hex(bytes) !== parsed.data.image_sha256)
      throw new Error("Synthetic image hash mismatch");
    documents.push(parsed.data);
  }
  return documents;
}
/** Validate split membership and the ordered document-image pair hashes. */
export async function loadSplits(
  directory: string,
  documents?: readonly SyntheticDocument[],
): Promise<DatasetSplits> {
  const labels = documents ?? (await loadSyntheticDocs(directory));
  const parsed = splitsSchema.safeParse(
    JSON.parse(await readFile(join(directory, "splits.json"), "utf8")),
  );
  if (!parsed.success) throw new Error("Invalid synthetic split manifest");
  const byId = new Map(labels.map((document) => [document.doc_id, document]));
  const used = new Set<string>();
  for (const split of ["screening", "held_out"] as const) {
    const pairs = parsed.data[split].map((id) => {
      const document = byId.get(id);
      if (!document || used.has(id))
        throw new Error("Invalid split membership");
      used.add(id);
      return [id, document.image_sha256];
    });
    if (sha256Hex(JSON.stringify(pairs)) !== parsed.data[`${split}_sha256`])
      throw new Error("Synthetic split hash mismatch");
  }
  return parsed.data;
}
