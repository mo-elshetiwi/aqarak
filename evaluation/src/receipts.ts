import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { modelCallRecordSchema, modelClassIdSchema } from "@aqarak/api/models";
import { safeIdSchema, itemIdSchema } from "./paths";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const runHeaderSchema = z
  .strictObject({
    record: z.literal("run"),
    runId: safeIdSchema,
    classId: modelClassIdSchema,
    candidateId: safeIdSchema,
    split: z.enum(["screening", "held_out"]),
    gitSha: z.string().regex(/^[a-f0-9]{40}$/),
    datasetManifestSha256: hash,
    splitSha256: hash,
    registrySha256: hash,
    scorerVersion: z.string().nullable(),
    command: z.string(),
    priceDate: z.iso.date(),
    startedAt: z.iso.datetime(),
  })
  .readonly();
export const callReceiptSchema = modelCallRecordSchema
  .unwrap()
  .extend({
    record: z.literal("call"),
    runId: safeIdSchema,
    itemId: itemIdSchema,
    rawOutputPath: z.string(),
    rawOutputSha256: hash,
  })
  .readonly();
export const receiptSchema = z.union([runHeaderSchema, callReceiptSchema]);
export type RunHeader = z.infer<typeof runHeaderSchema>;
export type CallReceipt = z.infer<typeof callReceiptSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
/** Read and validate every JSON-lines receipt, including header ownership. */
export async function readReceipts(path: string): Promise<readonly Receipt[]> {
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const receipts = lines.map((line) => {
    const parsed = receiptSchema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error("Invalid receipt");
    return parsed.data;
  });
  const header = receipts[0];
  if (header?.record !== "run") throw new Error("Missing run header");
  for (const record of receipts.slice(1))
    if (
      record.record !== "call" ||
      record.runId !== header.runId ||
      record.classId !== header.classId ||
      record.candidateId !== header.candidateId
    )
      throw new Error("Receipt does not belong to this run");
  return receipts;
}
export interface ReceiptWriter {
  readonly existing: readonly Receipt[];
  readonly append: (receipt: CallReceipt) => Promise<void>;
}
/** Create an exclusive receipt file or validate provenance before resuming it. */
export async function createReceiptWriter(options: {
  readonly path: string;
  readonly header: RunHeader;
  readonly resume: boolean;
}): Promise<ReceiptWriter> {
  const checked = runHeaderSchema.safeParse(options.header);
  if (!checked.success) throw new Error("Invalid run header");
  await mkdir(dirname(options.path), { recursive: true });
  let existing: readonly Receipt[] = [];
  try {
    await writeFile(options.path, `${JSON.stringify(checked.data)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    const parsed = z.object({ code: z.string() }).safeParse(error);
    if (!parsed.success || parsed.data.code !== "EEXIST" || !options.resume)
      throw new Error("Receipt file already exists or cannot be created");
    existing = await readReceipts(options.path);
    const previous = existing[0];
    if (previous?.record !== "run") throw new Error("Invalid previous header");
    for (const key of [
      "runId",
      "classId",
      "candidateId",
      "split",
      "gitSha",
      "datasetManifestSha256",
      "splitSha256",
      "registrySha256",
      "priceDate",
    ] as const)
      if (previous[key] !== options.header[key])
        throw new Error("Resume provenance mismatch");
  }
  let queue = Promise.resolve();
  return {
    existing,
    append(receipt): Promise<void> {
      const parsed = callReceiptSchema.safeParse(receipt);
      if (
        !parsed.success ||
        receipt.runId !== options.header.runId ||
        receipt.classId !== options.header.classId ||
        receipt.candidateId !== options.header.candidateId
      )
        return Promise.reject(new Error("Invalid call receipt"));
      queue = queue.then(async () => {
        await appendFile(options.path, `${JSON.stringify(parsed.data)}\n`);
      });
      return queue;
    },
  };
}
