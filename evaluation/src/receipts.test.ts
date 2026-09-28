import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createModelGateway, ZERO_USAGE, sha256Hex } from "@aqarak/api/models";
import {
  createReceiptWriter,
  readReceipts,
  callReceiptSchema,
} from "./receipts";
import type { RunHeader, CallReceipt } from "./receipts";
import { fakeRegistry, fakeRequest, temporaryDirectory } from "./test-fixtures";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const header: RunHeader = {
  record: "run",
  runId: "fixture",
  classId: "mc1_document_extraction",
  candidateId: "fake-candidate",
  split: "screening",
  gitSha: "a".repeat(40),
  datasetManifestSha256: "b".repeat(64),
  splitSha256: "c".repeat(64),
  registrySha256: "d".repeat(64),
  scorerVersion: null,
  command: "screen fixture",
  priceDate: "2026-09-28",
  startedAt: "2026-09-28T00:00:00Z",
};
async function call(): Promise<CallReceipt> {
  const gateway = createModelGateway({
    registry: fakeRegistry(),
    structuredAdapters: {
      openai_responses: {
        async generate() {
          await Promise.resolve();
          return {
            text: '{"value":"synthetic"}',
            modelEcho: null,
            usage: ZERO_USAGE,
            finish: "completed",
          };
        },
      },
    },
    transcriptionAdapters: {},
    now: () => new Date(header.startedAt),
  });
  const result = await gateway.generateStructured(fakeRequest());
  return {
    record: "call",
    runId: "fixture",
    itemId: "item",
    ...result.record,
    rawOutputPath: "raw/item.json",
    rawOutputSha256: sha256Hex("synthetic fixture"),
  };
}
it("round-trips every required field and rejects omission of each call field", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  const path = join(root, "receipts.jsonl");
  const writer = await createReceiptWriter({ path, header, resume: false });
  const receipt = await call();
  await writer.append(receipt);
  expect(await readReceipts(path)).toEqual([header, receipt]);
  for (const key of Object.keys(receipt))
    expect(
      callReceiptSchema.safeParse(
        Object.fromEntries(
          Object.entries(receipt).filter(([name]) => name !== key),
        ),
      ).success,
      key,
    ).toBe(false);
  await expect(
    createReceiptWriter({
      path,
      header: { ...header, registrySha256: "e".repeat(64) },
      resume: true,
    }),
  ).rejects.toThrow("Resume provenance mismatch");
});
it("rejects absent headers, malformed lines and receipts from another run", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  const path = join(root, "receipts.jsonl");
  const receipt = await call();
  await writeFile(path, JSON.stringify(receipt));
  await expect(readReceipts(path)).rejects.toThrow("Missing run header");
  await writeFile(
    path,
    `${JSON.stringify(header)}\n${JSON.stringify({ ...receipt, runId: "other" })}\n`,
  );
  await expect(readReceipts(path)).rejects.toThrow(
    "Receipt does not belong to this run",
  );
  await writeFile(path, `${JSON.stringify(header)}\n{}\n`);
  await expect(readReceipts(path)).rejects.toThrow("Invalid receipt");
});
