import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DOCUMENT_EXTRACTION_PROMPT,
  documentExtractionSchemaFor,
  getCandidate,
  registrySha256,
  sha256Hex,
  canonicalJson,
  ZERO_USAGE,
  toStrictJsonSchema,
} from "@aqarak/api/models";
import type {
  ModelGateway,
  ModelRegistry,
  ModelCandidate,
  ModelCallRecord,
  BudgetGuard,
} from "@aqarak/api/models";
import { loadSyntheticDocs, loadSplits } from "./datasets/synthetic-docs";
import type { SyntheticDocument } from "./datasets/synthetic-docs";
import { loadMixat } from "./datasets/mixat";
import { loadHeldOutSpeech } from "./datasets/held-out-speech";
import type { SpeechLabel } from "./datasets/held-out-speech";
import { prepareAudio } from "./audio";
import { createReceiptWriter } from "./receipts";
import type { RunHeader, ReceiptWriter } from "./receipts";
import { safeIdSchema, containedPath, requirePrivateDirectory } from "./paths";
export type ScreeningClass = "mc1_document_extraction" | "mc3_speech_to_text";
export interface ScreeningOptions {
  readonly classId: ScreeningClass;
  readonly candidateIds: readonly string[];
  readonly runId: string;
  readonly split: "screening" | "held_out";
  readonly speechSplitsPath?: string;
  readonly registry: ModelRegistry;
  readonly gateway: ModelGateway;
  readonly repositoryRoot: string;
  readonly resultsDir: string;
  readonly syntheticDir: string;
  readonly dataDir: string;
  readonly privateRunsDir: string;
  readonly gitSha: string;
  readonly command: string;
  readonly now: () => Date;
  readonly limit?: number;
  readonly concurrency?: number;
  readonly resume?: boolean;
  readonly signal?: AbortSignal;
  readonly beforeCandidate?: (
    candidate: ModelCandidate,
    candidateId: string,
  ) => Promise<void>;
  readonly budget?: BudgetGuard;
  readonly progress?: (line: string) => void;
  readonly prepareAudio?: typeof prepareAudio;
}
type Item =
  | {
      readonly id: string;
      readonly document: SyntheticDocument;
      readonly path: string;
    }
  | { readonly id: string; readonly clip: SpeechLabel; readonly path: string };
interface Dataset {
  readonly items: readonly Item[];
  readonly manifestSha256: string;
  readonly splitSha256: string;
  readonly rawRoot: string;
}
interface Collected {
  readonly record: ModelCallRecord;
  readonly raw: Readonly<Record<string, unknown>>;
}
async function datasetFor(options: ScreeningOptions): Promise<Dataset> {
  if (options.classId === "mc1_document_extraction") {
    const labels = await loadSyntheticDocs(options.syntheticDir);
    const splits = await loadSplits(options.syntheticDir, labels);
    const byId = new Map(labels.map((document) => [document.doc_id, document]));
    const items = splits[options.split].map((id) => {
      const document = byId.get(id);
      if (!document) throw new Error("Missing screening document");
      return {
        id,
        document,
        path: containedPath(options.syntheticDir, document.image),
      };
    });
    return {
      items,
      manifestSha256: sha256Hex(
        await readFile(join(options.syntheticDir, "manifest.json")),
      ),
      splitSha256: splits[`${options.split}_sha256`],
      rawRoot: options.resultsDir,
    };
  }
  const rawRoot = await requirePrivateDirectory(
    options.privateRunsDir,
    options.repositoryRoot,
  );
  if (options.split === "held_out") {
    const dataset = await loadHeldOutSpeech({
      dataDir: options.dataDir,
      splitsPath:
        options.speechSplitsPath ??
        join(
          options.repositoryRoot,
          "evaluation/datasets/speech-splits-v1.json",
        ),
    });
    return {
      items: dataset.clips.map((clip) => ({
        id: clip.id,
        clip,
        path: clip.path,
      })),
      manifestSha256: dataset.manifestSha256,
      splitSha256: dataset.splitSha256,
      rawRoot,
    };
  }
  const dataset = await loadMixat(options.dataDir);
  const byId = new Map(dataset.labels.map((clip) => [clip.id, clip]));
  const items = dataset.screeningIds.map((id) => {
    const clip = byId.get(id);
    if (!clip) throw new Error("Missing screening clip");
    return { id, clip, path: containedPath(dataset.directory, clip.file) };
  });
  return {
    items,
    manifestSha256: dataset.manifestSha256,
    splitSha256: dataset.splitSha256,
    rawRoot,
  };
}
function headerFor(
  options: ScreeningOptions,
  candidateId: string,
  dataset: Dataset,
): RunHeader {
  const candidate = getCandidate(
    options.registry,
    options.classId,
    candidateId,
  );
  return {
    record: "run",
    runId: options.runId,
    classId: options.classId,
    candidateId,
    split: options.split,
    gitSha: options.gitSha,
    datasetManifestSha256: dataset.manifestSha256,
    splitSha256: dataset.splitSha256,
    registrySha256: registrySha256(options.registry),
    scorerVersion: null,
    command: options.command,
    priceDate: candidate.price.priceDate,
    startedAt: options.now().toISOString(),
  };
}
function preparationFailure(
  options: ScreeningOptions,
  candidateId: string,
  item: Item,
  inputBytes: Uint8Array,
): ModelCallRecord {
  const candidate = getCandidate(
    options.registry,
    options.classId,
    candidateId,
  );
  const parameters = z
    .record(z.string(), z.json())
    .safeParse(candidate.parameters);
  if (!parameters.success) throw new Error("Invalid parameters");
  const timestamp = options.now().toISOString();
  const prompt = "document" in item ? DOCUMENT_EXTRACTION_PROMPT : null;
  const schemaId = "document" in item ? item.document.kind : null;
  return {
    classId: options.classId,
    candidateId,
    provider: candidate.provider,
    modelId: candidate.modelId,
    modelVersion:
      candidate.version.snapshot ??
      candidate.version.digest ??
      candidate.version.revision,
    modelEcho: null,
    parameters: parameters.data,
    parametersSha256: sha256Hex(canonicalJson(parameters.data)),
    promptId: prompt?.id ?? null,
    promptVersion: prompt?.version ?? null,
    promptSha256:
      "document" in item
        ? sha256Hex(
            canonicalJson([
              DOCUMENT_EXTRACTION_PROMPT.instructions,
              DOCUMENT_EXTRACTION_PROMPT.userTextFor(item.document.kind),
            ]),
          )
        : null,
    schemaId,
    schemaSha256:
      "document" in item
        ? sha256Hex(
            canonicalJson(
              toStrictJsonSchema(
                documentExtractionSchemaFor(item.document.kind),
                item.document.kind,
              ).schema,
            ),
          )
        : null,
    inputSha256: sha256Hex(inputBytes),
    outputSha256: null,
    usage: ZERO_USAGE,
    latencyMs: 0,
    costMicroUsd: 0,
    schemaValid: null,
    retries: 0,
    transportRetries: 0,
    status: "provider_error",
    errorCode: "input_preparation_error",
    errorMessage: "InputPreparationError",
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}
async function collect(
  options: ScreeningOptions,
  candidateId: string,
  item: Item,
): Promise<Collected> {
  if ("document" in item) {
    const document = item.document;
    const result = await options.gateway.generateStructured({
      classId: options.classId,
      candidateId,
      promptId: DOCUMENT_EXTRACTION_PROMPT.id,
      promptVersion: DOCUMENT_EXTRACTION_PROMPT.version,
      instructions: DOCUMENT_EXTRACTION_PROMPT.instructions,
      userText: DOCUMENT_EXTRACTION_PROMPT.userTextFor(document.kind),
      images: [{ mediaType: "image/jpeg", bytes: await readFile(item.path) }],
      schemaId: document.kind,
      schema: documentExtractionSchemaFor(document.kind),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      record: result.record,
      raw: {
        itemId: item.id,
        candidateId,
        status: result.record.status,
        output: result.output,
        rawText: result.rawText,
      },
    };
  }
  let audio;
  try {
    const cacheDir = await requirePrivateDirectory(
      join(options.privateRunsDir, "audio-cache"),
      options.repositoryRoot,
    );
    audio = await (options.prepareAudio ?? prepareAudio)({
      sourcePath: item.path,
      cacheDir,
    });
  } catch {
    const record = preparationFailure(
      options,
      candidateId,
      item,
      await readFile(item.path).catch(() => new Uint8Array()),
    );
    return {
      record,
      raw: {
        itemId: item.id,
        candidateId,
        status: record.status,
        text: null,
        detectedLanguage: null,
      },
    };
  }
  const result = await options.gateway.transcribe({
    classId: options.classId,
    candidateId,
    audio: {
      ...audio,
      mediaType: "audio/wav",
      fileName: `${audio.sha256}.wav`,
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return {
    record: result.record,
    raw: {
      itemId: item.id,
      candidateId,
      status: result.record.status,
      text: result.text,
      detectedLanguage: result.detectedLanguage,
    },
  };
}
async function parallelItems(
  items: readonly Item[],
  concurrency: number,
  run: (item: Item) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const item = items[next++];
      if (!item) return;
      try {
        await run(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected")
    throw new Error("Screening interrupted", { cause: rejected.reason });
}
async function runCandidate(
  options: ScreeningOptions,
  dataset: Dataset,
  candidateId: string,
  writer: ReceiptWriter,
): Promise<void> {
  const candidate = getCandidate(
    options.registry,
    options.classId,
    candidateId,
  );
  const rawDirectory = join(
    dataset.rawRoot,
    options.runId,
    options.classId,
    candidateId,
    "raw",
  );
  const completed = new Set(
    writer.existing
      .filter((receipt) => receipt.record === "call" && receipt.status === "ok")
      .map((receipt) => (receipt.record === "call" ? receipt.itemId : "")),
  );
  const items = dataset.items
    .slice(0, options.limit)
    .filter((item) => !completed.has(item.id));
  if (items.length === 0) return;
  await options.beforeCandidate?.(candidate, candidateId);
  const rawDir =
    options.classId === "mc3_speech_to_text"
      ? await requirePrivateDirectory(rawDirectory, options.repositoryRoot)
      : rawDirectory;
  await mkdir(rawDir, { recursive: true });
  await parallelItems(
    items,
    candidate.runtime === "local" ? 1 : (options.concurrency ?? 4),
    async (item) => {
      options.signal?.throwIfAborted();
      const result = await collect(options, candidateId, item);
      const rawPath = join(rawDir, `${item.id}.json`);
      await mkdir(dirname(rawPath), { recursive: true });
      const temporary = `${rawPath}.${randomUUID()}.tmp`;
      const raw = `${JSON.stringify(result.raw)}\n`;
      await writeFile(temporary, raw);
      await rename(temporary, rawPath);
      await writer.append({
        record: "call",
        runId: options.runId,
        itemId: item.id,
        ...result.record,
        rawOutputPath:
          options.classId === "mc1_document_extraction"
            ? relative(options.repositoryRoot, rawPath)
            : `private-runs:${options.runId}/${options.classId}/${candidateId}/raw/${item.id}.json`,
        rawOutputSha256: sha256Hex(raw),
      });
      options.progress?.(
        `${item.id} ${candidateId} ${result.record.status} ${String(result.record.latencyMs)}ms`,
      );
    },
  );
}
function validateSelection(options: ScreeningOptions): void {
  if (
    !safeIdSchema.safeParse(options.runId).success ||
    options.candidateIds.length === 0 ||
    new Set(options.candidateIds).size !== options.candidateIds.length
  )
    throw new Error("Invalid screening selection");
  for (const candidateId of options.candidateIds) {
    if (!safeIdSchema.safeParse(candidateId).success)
      throw new Error("Invalid candidate id");
    getCandidate(options.registry, options.classId, candidateId);
  }
  if (
    options.concurrency !== undefined &&
    (!Number.isInteger(options.concurrency) || options.concurrency < 1)
  )
    throw new Error("Invalid concurrency");
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  )
    throw new Error("Invalid limit");
}
async function prepareReceipts(
  options: ScreeningOptions,
  dataset: Dataset,
): Promise<ReadonlyMap<string, ReceiptWriter>> {
  const writers = new Map<string, ReceiptWriter>();
  for (const candidateId of options.candidateIds) {
    const writer = await createReceiptWriter({
      path: join(
        options.resultsDir,
        options.runId,
        options.classId,
        candidateId,
        "receipts.jsonl",
      ),
      header: headerFor(options, candidateId, dataset),
      resume: options.resume ?? false,
    });
    for (const receipt of writer.existing)
      if (receipt.record === "call")
        options.budget?.add(options.classId, receipt.costMicroUsd);
    writers.set(candidateId, writer);
  }
  return writers;
}
/** Collect every selected item with raw output and validated receipts, resuming only successful calls. */
export async function runScreening(options: ScreeningOptions): Promise<void> {
  validateSelection(options);
  const dataset = await datasetFor(options);
  const writers = await prepareReceipts(options, dataset);
  for (const [candidateId, writer] of writers)
    await runCandidate(options, dataset, candidateId, writer);
}
