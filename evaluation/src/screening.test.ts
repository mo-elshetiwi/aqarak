import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createBudgetGuard, sha256Hex } from "@aqarak/api/models";
import type {
  ModelGateway,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "@aqarak/api/models";
import {
  temporaryDirectory,
  writeSyntheticFixture,
  fixtureGateway,
  fixtureScreeningOptions,
  fakeRegistry,
  fakeWav,
} from "./test-fixtures";
import { runScreening } from "./screening";
import { readReceipts } from "./receipts";
import { loadSplits } from "./datasets/synthetic-docs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await temporaryDirectory();
  roots.push(root);
  const registry = fakeRegistry();
  const gateway = fixtureGateway(registry);
  const options = fixtureScreeningOptions(root, registry, gateway);
  await writeSyntheticFixture(options.syntheticDir);
  await mkdir(options.repositoryRoot);
  const candidateDir = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "fake-candidate",
  );
  return { root, options, gateway, candidateDir };
}
it("screens two committed documents with a fake gateway into temporary results", async () => {
  const { options, gateway, candidateDir } = await fixture();
  const syntheticDir = fileURLToPath(
    new URL("../datasets/synthetic-docs-v1/", import.meta.url),
  );
  const generate = vi.spyOn(gateway, "generateStructured");
  await runScreening({ ...options, syntheticDir, limit: 2 });
  const splits = await loadSplits(syntheticDir);
  const receipts = await readReceipts(join(candidateDir, "receipts.jsonl"));
  expect(generate).toHaveBeenCalledTimes(2);
  expect(receipts).toHaveLength(3);
  expect(receipts[0]).toMatchObject({
    record: "run",
    classId: "mc1_document_extraction",
    splitSha256: splits.screening_sha256,
  });
  for (const [index, itemId] of splits.screening.slice(0, 2).entries())
    expect(receipts[index + 1]).toMatchObject({
      record: "call",
      itemId,
      status: "ok",
    });
  expect(await readdir(join(candidateDir, "raw"))).toEqual(
    splits.screening.slice(0, 2).map((id) => `${id}.json`),
  );
});
it("AC-9 resumes after two committed calls with exactly three raw files and three call receipts", async () => {
  const { options, gateway, candidateDir } = await fixture();
  let calls = 0;
  const interrupted: ModelGateway = {
    ...gateway,
    async generateStructured<T>(
      request: StructuredGenerationRequest<T>,
    ): Promise<StructuredGenerationResult<T>> {
      if (++calls === 3) throw new Error("fixture interruption");
      return gateway.generateStructured(request);
    },
  };
  await expect(
    runScreening({ ...options, gateway: interrupted }),
  ).rejects.toThrow("Screening interrupted");
  expect(await readReceipts(join(candidateDir, "receipts.jsonl"))).toHaveLength(
    3,
  );
  const progress: string[] = [];
  await runScreening({
    ...options,
    resume: true,
    progress: (line) => progress.push(line),
  });
  const receipts = await readReceipts(join(candidateDir, "receipts.jsonl"));
  expect(receipts).toHaveLength(4);
  expect(
    receipts
      .filter((record) => record.record === "call")
      .map((record) => record.itemId),
  ).toEqual(["doc-1", "doc-2", "doc-3"]);
  expect(await readdir(join(candidateDir, "raw"))).toEqual([
    "doc-1.json",
    "doc-2.json",
    "doc-3.json",
  ]);
  expect(progress).toEqual(["doc-3 fake-candidate ok 0ms"]);
  for (const receipt of receipts)
    if (receipt.record === "call")
      expect(
        sha256Hex(
          await readFile(join(options.repositoryRoot, receipt.rawOutputPath)),
        ),
      ).toBe(receipt.rawOutputSha256);
});
it("AC-9 rejects a tampered split before a gateway call or receipt", async () => {
  const { options, gateway, candidateDir } = await fixture();
  const generate = vi.spyOn(gateway, "generateStructured");
  const split = await loadSplits(options.syntheticDir);
  await writeFile(
    join(options.syntheticDir, "splits.json"),
    JSON.stringify({ ...split, screening_sha256: "0".repeat(64) }),
  );
  await expect(runScreening(options)).rejects.toThrow(
    "Synthetic split hash mismatch",
  );
  expect(generate).not.toHaveBeenCalled();
  await expect(
    readFile(join(candidateDir, "receipts.jsonl")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("keeps budget-stopped items and restores previous spend on resume", async () => {
  const { options, candidateDir } = await fixture();
  const budget = createBudgetGuard({ mc1_document_extraction: 1 });
  const gateway = fixtureGateway(options.registry, budget);
  await runScreening({ ...options, gateway, budget });
  let receipts = await readReceipts(join(candidateDir, "receipts.jsonl"));
  expect(
    receipts
      .filter((record) => record.record === "call")
      .map((record) => record.status),
  ).toEqual(["ok", "budget_stopped", "budget_stopped"]);
  const resumedBudget = createBudgetGuard({ mc1_document_extraction: 1 });
  await runScreening({
    ...options,
    resume: true,
    budget: resumedBudget,
    gateway: fixtureGateway(options.registry, resumedBudget),
  });
  receipts = await readReceipts(join(candidateDir, "receipts.jsonl"));
  expect(receipts).toHaveLength(6);
  expect(resumedBudget.spentMicroUsd(options.classId)).toBe(19);
  expect(receipts.at(-1)).toMatchObject({ status: "budget_stopped" });
});
it.each(["openai_responses", "ollama"] as const)(
  "limits %s execution to its configured worker count",
  async (provider) => {
    const { options } = await fixture();
    const registry = fakeRegistry(provider);
    const original = fixtureGateway(registry);
    let active = 0;
    let maximum = 0;
    const gateway: ModelGateway = {
      ...original,
      async generateStructured<T>(
        request: StructuredGenerationRequest<T>,
      ): Promise<StructuredGenerationResult<T>> {
        active++;
        maximum = Math.max(maximum, active);
        await setTimeout(5);
        try {
          return await original.generateStructured(request);
        } finally {
          active--;
        }
      },
    };
    const beforeCandidate = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });
    await runScreening({
      ...options,
      registry,
      gateway,
      concurrency: 2,
      beforeCandidate,
    });
    expect(maximum).toBe(provider === "ollama" ? 1 : 2);
    expect(beforeCandidate).toHaveBeenCalledTimes(1);
  },
);
it("writes speech content only to the private directory and hashes only in receipts", async () => {
  const { options } = await fixture();
  const registry = fakeRegistry("openai_transcription");
  const directory = join(options.dataDir, "mixat");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "labels.jsonl"),
    JSON.stringify({
      id: "clip-1",
      part: "fixture",
      file: "clip.wav",
      split: "screening",
      language: "ar",
      duration_ms: 200,
      transcript: "synthetic reference",
    }) + "\n",
  );
  await writeFile(join(directory, "screening_ids.txt"), "clip-1\n");
  await writeFile(join(directory, "manifest.json"), "{}");
  const wav = fakeWav();
  const path = join(directory, "clip.wav");
  await writeFile(path, wav);
  const prepareAudio = vi.fn(async () => {
    await Promise.resolve();
    return { path, bytes: wav, sha256: sha256Hex(wav), durationMs: 200 };
  });
  await runScreening({
    ...options,
    classId: "mc3_speech_to_text",
    registry,
    gateway: fixtureGateway(registry),
    prepareAudio,
  });
  const receiptPath = join(
    options.resultsDir,
    options.runId,
    "mc3_speech_to_text/fake-candidate/receipts.jsonl",
  );
  const text = await readFile(receiptPath, "utf8");
  expect(text).not.toContain("synthetic hypothesis");
  expect(text).not.toContain("synthetic reference");
  for (const line of text.trim().split("\n")) {
    expect(line).not.toContain(options.privateRunsDir);
    expect(line).not.toContain(options.dataDir);
    expect(line).not.toContain(options.repositoryRoot);
    expect(line).not.toMatch(/"\//u);
  }
  const rawPath = join(
    options.privateRunsDir,
    options.runId,
    "mc3_speech_to_text/fake-candidate/raw/clip-1.json",
  );
  const raw = await readFile(rawPath, "utf8");
  expect(raw).toContain("synthetic hypothesis");
  expect((await readReceipts(receiptPath)).at(-1)).toMatchObject({
    rawOutputPath: `private-runs:${options.runId}/mc3_speech_to_text/fake-candidate/raw/clip-1.json`,
    rawOutputSha256: sha256Hex(raw),
    status: "ok",
    usage: { audioSeconds: 0.2 },
  });
  expect(prepareAudio).toHaveBeenCalledTimes(1);
});
it("refuses speech output inside the repository before starting a call", async () => {
  const { options, gateway } = await fixture();
  const transcribe = vi.spyOn(gateway, "transcribe");
  await expect(
    runScreening({
      ...options,
      classId: "mc3_speech_to_text",
      privateRunsDir: join(options.repositoryRoot, "private"),
    }),
  ).rejects.toThrow("Private output must be outside the repository");
  expect(transcribe).not.toHaveBeenCalled();
});

it("collects only held-out documents with their frozen hash", async () => {
  const { options, gateway, candidateDir } = await fixture();
  const syntheticDir = fileURLToPath(
    new URL("../datasets/synthetic-docs-v1/", import.meta.url),
  );
  const generate = vi.spyOn(gateway, "generateStructured");
  await runScreening({ ...options, syntheticDir, split: "held_out", limit: 2 });
  const splits = await loadSplits(syntheticDir);
  const receipts = await readReceipts(join(candidateDir, "receipts.jsonl"));
  expect(generate).toHaveBeenCalledTimes(2);
  expect(receipts[0]).toMatchObject({
    split: "held_out",
    splitSha256: splits.held_out_sha256,
  });
  expect(
    receipts
      .slice(1)
      .map((receipt) => (receipt.record === "call" ? receipt.itemId : null)),
  ).toEqual(splits.held_out.slice(0, 2));
});
