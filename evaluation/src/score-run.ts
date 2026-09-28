import { join, relative, resolve, isAbsolute, sep } from "node:path";
import { z } from "zod";
import { callStatusSchema, sha256Hex } from "@aqarak/api/models";
import type { loadSyntheticDocs, loadSplits } from "./datasets/synthetic-docs";
import { loadHeldOutSpeech } from "./datasets/held-out-speech";
import type { loadMixat } from "./datasets/mixat";
import type { readReceipts, CallReceipt, RunHeader } from "./receipts";
import { containedPath, safeIdSchema, itemIdSchema } from "./paths";
import {
  SCORER_VERSION,
  scoreDocuments,
  scoreField,
  scoreSpeech,
  compareSpeechCandidates,
  applyScreeningRules,
  wilsonInterval,
  pairedBootstrapDifference,
  renderCsv,
  renderScreeningReport,
} from "./scoring/index";
import type {
  DocumentLabel,
  DocumentResult,
  Interval,
  RatioCluster,
  TableCell,
  ReportCandidate,
  ScreeningDecision,
  ScreeningReportModel,
} from "./scoring/index";

export type ScoreClass = "mc1_document_extraction" | "mc3_speech_to_text";

/** I inject filesystem operations and dataset readers to isolate scoring fixtures. */
export interface ScoreRunIO {
  readonly readBytes: (path: string) => Promise<Uint8Array>;
  readonly writeText: (path: string, text: string) => Promise<void>;
  readonly listCandidates: (directory: string) => Promise<readonly string[]>;
  readonly realpath: (path: string) => Promise<string>;
  readonly readReceipts: typeof readReceipts;
  readonly loadSyntheticDocs: typeof loadSyntheticDocs;
  readonly loadSplits: typeof loadSplits;
  readonly loadMixat: typeof loadMixat;
}

export interface ScoreRunOptions {
  readonly runId: string;
  readonly classId: ScoreClass;
  readonly candidateIds?: readonly string[];
  readonly repositoryRoot: string;
  readonly resultsDir: string;
  readonly syntheticDir: string;
  readonly speechSplitsPath: string;
  readonly dataDir: string;
  readonly privateRunsDir: string;
  readonly limitationsPath?: string;
  readonly io: ScoreRunIO;
}

const statuses = [...callStatusSchema.options, "not_run"] as const;
type Row = Readonly<Record<string, TableCell>>;
type Table = readonly Row[];
interface CandidateRun {
  readonly header: RunHeader;
  readonly calls: readonly CallReceipt[];
  readonly final: ReadonlyMap<string, { receipt: CallReceipt; raw: unknown }>;
}
interface DatasetFacts {
  readonly ids: readonly string[];
  readonly manifestSha256: string;
  readonly splitSha256: string;
  readonly receiptSplitSha256: string;
}
interface Tables {
  readonly summary: Table;
  readonly details: Readonly<
    Record<string, { columns: readonly string[]; rows: Table }>
  >;
  readonly candidates: unknown;
  readonly report: ScreeningReportModel;
}

const rawIdentity = z.object({
  itemId: itemIdSchema,
  candidateId: safeIdSchema,
  status: callStatusSchema,
});
const extractionRaw = rawIdentity.extend({
  output: z
    .object({
      fields: z.record(
        z.string(),
        z.object({
          value: z.union([z.string(), z.number(), z.null()]),
          evidence: z.unknown(),
          null_reason: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});
const speechRaw = rawIdentity.extend({ text: z.string().nullable() });
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const speechSplitsSchema = z.object({
  dataset: z.literal("speech-splits-v1"),
  screening: z
    .array(z.tuple([safeIdSchema, hash, z.enum(["Arabic", "CS", "English"])]))
    .min(1),
  screening_sha256: hash,
  sources: z.array(z.object({ name: z.string(), manifest_sha256: hash })),
});

function check(condition: boolean, message: string): asserts condition {
  if (condition) return;
  throw new Error(message);
}

async function readJson(
  options: ScoreRunOptions,
  path: string,
): Promise<unknown> {
  try {
    return JSON.parse(
      Buffer.from(await options.io.readBytes(path)).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error(`Cannot read JSON: ${path}`);
  }
}

function within(root: string, path: string): boolean {
  const difference = relative(resolve(root), resolve(path));
  if (
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  )
    return false;
  return true;
}

async function rawPathFor(
  options: ScoreRunOptions,
  receipt: CallReceipt,
): Promise<string> {
  const speech = options.classId === "mc3_speech_to_text";
  const prefix = "private-runs:";
  check(
    receipt.rawOutputPath.startsWith(prefix) === speech,
    "Raw output location does not match class",
  );
  const root = speech ? options.privateRunsDir : options.repositoryRoot;
  const path = containedPath(
    root,
    speech ? receipt.rawOutputPath.slice(prefix.length) : receipt.rawOutputPath,
  );
  const candidateRoot = join(
    speech ? options.privateRunsDir : options.resultsDir,
    options.runId,
    options.classId,
    receipt.candidateId,
    "raw",
  );
  check(
    within(candidateRoot, path),
    `Raw output leaves candidate directory: ${path}`,
  );
  const actual = await options.io.realpath(path);
  check(
    within(await options.io.realpath(candidateRoot), actual),
    `Raw output leaves candidate directory: ${path}`,
  );
  if (
    speech &&
    within(await options.io.realpath(options.repositoryRoot), actual)
  )
    throw new Error("Speech raw output must be outside the repository");
  return path;
}

async function readCandidate(
  options: ScoreRunOptions,
  candidateId: string,
): Promise<CandidateRun> {
  const receipts = await options.io.readReceipts(
    join(
      options.resultsDir,
      options.runId,
      options.classId,
      candidateId,
      "receipts.jsonl",
    ),
  );
  const header = receipts[0];
  check(header?.record === "run", "Missing run header");
  check(
    header.runId === options.runId &&
      header.classId === options.classId &&
      header.candidateId === candidateId,
    "Run header does not match selection",
  );
  const calls: CallReceipt[] = [];
  const final = new Map<string, { receipt: CallReceipt; raw: unknown }>();
  for (const receipt of receipts.slice(1)) {
    check(receipt.record === "call", "Unexpected run header");
    const path = await rawPathFor(options, receipt);
    const bytes = await options.io.readBytes(path);
    check(
      sha256Hex(bytes) === receipt.rawOutputSha256,
      `Raw output SHA-256 mismatch: ${path}`,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    } catch {
      throw new Error(`Invalid raw output: ${path}`);
    }
    const identity = rawIdentity.safeParse(raw);
    check(identity.success, `Invalid raw output: ${path}`);
    check(
      identity.data.itemId === receipt.itemId &&
        identity.data.candidateId === candidateId &&
        identity.data.status === receipt.status,
      `Raw output does not match receipt: ${path}`,
    );
    calls.push(receipt);
    final.set(receipt.itemId, { receipt, raw });
  }
  return { header, calls, final };
}

function validateFacts(
  runs: readonly CandidateRun[],
  dataset: DatasetFacts,
): void {
  check(
    dataset.ids.length > 0 && new Set(dataset.ids).size === dataset.ids.length,
    "Invalid or empty scoring split",
  );
  const first = runs[0]?.header;
  check(first !== undefined, "No candidates with receipts");
  const ids = new Set(dataset.ids);
  for (const run of runs) {
    const header = run.header;
    check(
      header.datasetManifestSha256 === dataset.manifestSha256,
      "Dataset manifest hash does not match run header",
    );
    check(
      header.splitSha256 === dataset.receiptSplitSha256 ||
        header.splitSha256 === dataset.splitSha256,
      "Split hash does not match run header",
    );
    for (const key of [
      "classId",
      "datasetManifestSha256",
      "priceDate",
      "split",
      "splitSha256",
    ] as const)
      check(header[key] === first[key], `Candidate run facts differ: ${key}`);
    for (const call of run.calls)
      check(
        ids.has(call.itemId),
        `Receipt item is outside the scoring split: ${call.itemId}`,
      );
  }
}

function validateExtractionFacts(
  runs: readonly CandidateRun[],
  labels: readonly DocumentLabel[],
): void {
  const kinds = new Map(labels.map((label) => [label.doc_id, label.kind]));
  const facts = new Map<
    string,
    Pick<CallReceipt, "promptSha256" | "schemaSha256">
  >();
  for (const run of runs) {
    for (const call of run.calls) {
      if (call.status !== "ok" && call.status !== "schema_invalid") continue;
      const kind = kinds.get(call.itemId);
      check(kind !== undefined, `Missing document kind: ${call.itemId}`);
      for (const key of ["promptSha256", "schemaSha256"] as const) {
        check(call[key] !== null, `Missing extraction ${key}: ${kind}`);
        const previous = facts.get(kind);
        check(
          previous === undefined || previous[key] === call[key],
          `Candidate extraction facts differ: ${key} (${kind})`,
        );
      }
      facts.set(kind, call);
    }
  }
}

function quantile(
  values: readonly number[],
  probability: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = sorted[Math.floor(position)] ?? 0;
  return (
    lower +
    ((sorted[Math.ceil(position)] ?? lower) - lower) *
      (position - Math.floor(position))
  );
}

function operational(run: CandidateRun, ids: readonly string[]) {
  const statusCounts = Object.fromEntries(
    statuses.map((status) => [
      status,
      ids.filter(
        (id) => (run.final.get(id)?.receipt.status ?? "not_run") === status,
      ).length,
    ]),
  );
  const okCalls = run.calls.filter((call) => call.status === "ok");
  const latencies = okCalls.map((call) => call.latencyMs / 1000);
  const microUsd = run.calls.reduce(
    (total, call) => total + BigInt(call.costMicroUsd),
    0n,
  );
  check(
    microUsd <= BigInt(Number.MAX_SAFE_INTEGER),
    "Cost exceeds safe integer range",
  );
  return {
    candidate: run.header.candidateId,
    git_sha: run.header.gitSha,
    registry_sha256: run.header.registrySha256,
    items: ids.length,
    ...statusCounts,
    cost_usd: Number(microUsd) / 1000000,
    latency_p50_s: quantile(latencies, 0.5),
    latency_p95_s: quantile(latencies, 0.95),
    statusCounts,
  };
}

function intervalCells(name: string, interval: Interval | null): Row {
  return {
    [name]: interval?.estimate ?? null,
    [`${name}_low`]: interval?.lower ?? null,
    [`${name}_high`]: interval?.upper ?? null,
  };
}

function differenceCells(interval: Interval | null): Row {
  return {
    difference_to_best: interval?.estimate ?? null,
    difference_low: interval?.lower ?? null,
    difference_high: interval?.upper ?? null,
  };
}

function decisionFor(
  decisions: readonly ScreeningDecision[],
  candidateId: string,
): ScreeningDecision {
  const decision = decisions.find((entry) => entry.candidateId === candidateId);
  check(decision !== undefined, "Missing screening decision");
  return decision;
}

function decisionCells(decision: ScreeningDecision): Row {
  return {
    screening_decision: decision.decision,
    screening_reasons: decision.reasons.join(" "),
  };
}

function reportBase(
  run: CandidateRun,
  ids: readonly string[],
  screening: ScreeningDecision,
): Omit<ReportCandidate, "schemaValidRate" | "primary" | "secondaries"> {
  const value = operational(run, ids);
  return {
    candidateId: value.candidate,
    items: value.items,
    statusCounts: value.statusCounts,
    totalCostUsd: value.cost_usd,
    p50LatencySeconds: value.latency_p50_s ?? 0,
    p95LatencySeconds: value.latency_p95_s ?? 0,
    screening,
  };
}

function reportFacts(run: CandidateRun) {
  const header = run.header;
  return {
    candidateId: header.candidateId,
    gitCommit: header.gitSha,
    datasetManifestSha256: header.datasetManifestSha256,
    splitSha256: header.splitSha256,
    registrySha256: header.registrySha256,
    scorerVersion: SCORER_VERSION,
    priceDate: header.priceDate,
    command: header.command,
    startedAt: header.startedAt,
  };
}

function documentResults(
  run: CandidateRun,
  labels: readonly DocumentLabel[],
): readonly DocumentResult[] {
  return labels.map((label) => {
    const entry = run.final.get(label.doc_id);
    if (entry === undefined)
      return {
        candidateId: run.header.candidateId,
        doc_id: label.doc_id,
        status: "not_run",
        output: null,
      };
    const parsed = extractionRaw.safeParse(entry.raw);
    check(parsed.success, `Invalid extraction output for ${label.doc_id}`);
    check(
      parsed.data.status === "ok" ? parsed.data.output !== null : true,
      `Missing successful extraction output for ${label.doc_id}`,
    );
    return {
      candidateId: run.header.candidateId,
      doc_id: label.doc_id,
      status: parsed.data.status,
      output: parsed.data.output,
    };
  });
}

function documentDetails(
  labels: readonly DocumentLabel[],
  results: readonly DocumentResult[],
) {
  const byId = new Map(labels.map((label) => [label.doc_id, label]));
  const outcomes: Row[] = [];
  const accuracy = new Map<string, Map<string, RatioCluster>>();
  const groups = new Map<
    string,
    {
      candidate: string;
      kind: string;
      field: string;
      type: string;
      script: string;
      readable: number;
      correct: number;
    }
  >();
  for (const result of results) {
    const label = byId.get(result.doc_id);
    check(label !== undefined, "Missing document label");
    const cluster = { numerator: 0, denominator: 0 };
    for (const [field, truth] of Object.entries(label.fields)) {
      const value = result.output?.fields[field]?.value ?? null;
      const outcome =
        truth.condition === "readable" && result.status !== "ok"
          ? "missing"
          : scoreField(truth, value);
      outcomes.push({
        candidate: result.candidateId,
        doc_id: label.doc_id,
        field,
        condition: truth.condition,
        outcome,
      });
      const key = JSON.stringify([
        result.candidateId,
        label.kind,
        field,
        truth.type,
        truth.script,
      ]);
      const group = groups.get(key) ?? {
        candidate: result.candidateId,
        kind: label.kind,
        field,
        type: truth.type,
        script: truth.script,
        readable: 0,
        correct: 0,
      };
      cluster.denominator += truth.condition === "readable" ? 1 : 0;
      cluster.numerator += outcome === "correct" ? 1 : 0;
      group.readable += truth.condition === "readable" ? 1 : 0;
      group.correct += outcome === "correct" ? 1 : 0;
      groups.set(key, group);
    }
    const candidate =
      accuracy.get(result.candidateId) ?? new Map<string, RatioCluster>();
    candidate.set(result.doc_id, cluster);
    accuracy.set(result.candidateId, candidate);
  }
  return {
    accuracy,
    outcomes,
    fields: [...groups.values()].map((group) => ({
      ...group,
      accuracy: group.readable === 0 ? null : group.correct / group.readable,
    })),
  };
}

async function extractionTables(
  options: ScoreRunOptions,
  runs: readonly CandidateRun[],
  limitations: readonly string[],
): Promise<Tables> {
  const documents = await options.io.loadSyntheticDocs(options.syntheticDir);
  const splits = await options.io.loadSplits(options.syntheticDir, documents);
  const selectedSplit = runs[0]?.header.split ?? "screening";
  const byId = new Map(
    documents.map((document) => [document.doc_id, document]),
  );
  const labels: DocumentLabel[] = splits[selectedSplit].map((id) => {
    const document = byId.get(id);
    check(document !== undefined, `Missing document label: ${id}`);
    return {
      doc_id: id,
      kind: document.kind,
      fields: Object.fromEntries(
        Object.entries(document.fields).map(([name, field]) => [
          name,
          {
            ...field,
            script:
              field.script === "arabic"
                ? "arabic"
                : field.script === "latin"
                  ? "latin"
                  : "neutral",
          },
        ]),
      ),
    };
  });
  validateFacts(runs, {
    ids: splits[selectedSplit],
    manifestSha256: sha256Hex(
      await options.io.readBytes(join(options.syntheticDir, "manifest.json")),
    ),
    splitSha256: splits[`${selectedSplit}_sha256`],
    receiptSplitSha256: splits[`${selectedSplit}_sha256`],
  });
  validateExtractionFacts(runs, labels);
  const results = runs.flatMap((run) => documentResults(run, labels));
  const scores = scoreDocuments(labels, results).map((score, index) => {
    const run = runs[index];
    check(run !== undefined, "Missing candidate run");
    return {
      ...score,
      criticalFailures: score.fabrications.filter((entry) => {
        const field = byId.get(entry.doc_id)?.fields[entry.field];
        check(field !== undefined, "Missing fabrication label");
        return field.type === "money" || field.type === "date";
      }).length,
      perKindCounts: Object.fromEntries(
        Object.keys(score.perKindFieldAccuracy).map((kind) => {
          const documents = labels.filter((label) => label.kind === kind);
          return [
            kind,
            {
              documents: documents.length,
              not_run: documents.filter(
                (label) => run.final.get(label.doc_id) === undefined,
              ).length,
              readable_fields: documents.reduce(
                (total, label) =>
                  total +
                  Object.values(label.fields).filter(
                    (field) => field.condition === "readable",
                  ).length,
                0,
              ),
            },
          ];
        }),
      ),
    };
  });
  const decisions = applyScreeningRules({
    candidates: scores.map((score) => ({
      candidateId: score.candidateId,
      schemaValidRate: score.schemaValidRate?.estimate ?? 0,
      primary: score.fieldAccuracy?.estimate ?? 0,
      criticalFailures: score.criticalFailures,
    })),
    margin: { kind: "absolute", value: 0.02, higherIsBetter: true },
  });
  const details = documentDetails(labels, results);
  const best = [...scores].sort(
    (a, b) =>
      (b.fieldAccuracy?.estimate ?? -Infinity) -
        (a.fieldAccuracy?.estimate ?? -Infinity) ||
      (a.candidateId < b.candidateId
        ? -1
        : a.candidateId > b.candidateId
          ? 1
          : 0),
  )[0];
  if (best === undefined) throw new Error("Missing extraction candidate");
  const compared = scores.map((score) => ({
    ...score,
    bestCandidateId: best.candidateId,
    differenceToBest:
      score.candidateId === best.candidateId
        ? { estimate: 0, lower: 0, upper: 0 }
        : pairedBootstrapDifference(
            [...splits[selectedSplit]].sort().map((id) => {
              const a = details.accuracy.get(score.candidateId)?.get(id);
              const b = details.accuracy.get(best.candidateId)?.get(id);
              if (a === undefined || b === undefined)
                throw new Error("Missing paired document cluster");
              return { a, b };
            }),
          ),
  }));
  const summary = compared.map((score, index) => {
    const run = runs[index];
    check(run !== undefined, "Missing candidate run");
    const { statusCounts, ...base } = operational(run, splits[selectedSplit]);
    return {
      ...base,
      ...statusCounts,
      ...intervalCells("schema_valid", score.schemaValidRate),
      schema_valid_rate: score.schemaValidRate?.estimate ?? null,
      ...intervalCells("field_accuracy", score.fieldAccuracy),
      ...differenceCells(score.differenceToBest),
      missing_field_rate: score.missingFieldRate?.estimate ?? null,
      incorrect_rate: score.incorrectRate?.estimate ?? null,
      ...intervalCells("unsupported_fill", score.unsupportedFillRate),
      unsupported_fill_rate: score.unsupportedFillRate?.estimate ?? null,
      unavailable_fields: score.unavailableFields,
      unsupported_fills: score.unsupportedFills,
      distractor_capture_rate: score.distractorCaptureRate?.estimate ?? null,
      distractor_fields: score.distractorFields,
      ...intervalCells("exact_document", score.exactDocumentRate),
      exact_document_rate: score.exactDocumentRate?.estimate ?? null,
      arabic_field_accuracy: score.arabicScriptFieldAccuracy?.estimate ?? null,
      fabrications: score.fabrications.length,
      critical_failures: score.criticalFailures,
      cost_usd_per_1000_items: (base.cost_usd * 1000) / labels.length,
      ...decisionCells(decisionFor(decisions, score.candidateId)),
    };
  });
  return {
    summary,
    details: {
      "per-field.csv": {
        columns: [
          "candidate",
          "kind",
          "field",
          "type",
          "script",
          "readable",
          "correct",
          "accuracy",
        ],
        rows: details.fields,
      },
      "per-kind.csv": {
        columns: [
          "candidate",
          "kind",
          "documents",
          "not_run",
          "readable_fields",
          "field_accuracy",
          "field_accuracy_low",
          "field_accuracy_high",
        ],
        rows: scores.flatMap((score) =>
          Object.entries(score.perKindFieldAccuracy).map(([kind, value]) => ({
            candidate: score.candidateId,
            kind,
            ...score.perKindCounts[kind],
            ...intervalCells("field_accuracy", value),
          })),
        ),
      },
      "fabrications.csv": {
        columns: [
          "candidate",
          "doc_id",
          "field",
          "type",
          "condition",
          "returned_value",
        ],
        rows: scores.flatMap((score) =>
          score.fabrications.map((entry) => {
            const label = byId.get(entry.doc_id)?.fields[entry.field];
            check(label !== undefined, "Missing fabrication label");
            return {
              candidate: score.candidateId,
              doc_id: entry.doc_id,
              field: entry.field,
              type: label.type,
              condition: label.condition,
              returned_value: entry.value,
            };
          }),
        ),
      },
      "document-outcomes.csv": {
        columns: ["candidate", "doc_id", "field", "condition", "outcome"],
        rows: details.outcomes,
      },
    },
    candidates: compared,
    report: {
      class: "extraction",
      runId: options.runId,
      ...(runs[0]?.header.split === "held_out"
        ? { split: "held_out" as const }
        : {}),
      facts: runs.map(reportFacts),
      limitations,
      candidates: compared.map((score, index) => {
        const run = runs[index];
        check(run !== undefined, "Missing candidate run");
        return {
          ...reportBase(
            run,
            splits[selectedSplit],
            decisionFor(decisions, score.candidateId),
          ),
          schemaValidRate: score.schemaValidRate,
          primary: {
            name: "Pooled field accuracy",
            interval: score.fieldAccuracy,
          },
          secondaries: {
            "Paired accuracy difference to best": score.differenceToBest,
            "Missing field rate": score.missingFieldRate,
            "Incorrect rate": score.incorrectRate,
            "Unsupported fill rate": score.unsupportedFillRate,
            "Distractor capture rate": score.distractorCaptureRate,
            "Exact document rate": score.exactDocumentRate,
            "Arabic field accuracy": score.arabicScriptFieldAccuracy,
          },
          extraction: score,
        };
      }),
    },
  };
}

async function speechDataset(
  options: ScoreRunOptions,
  runs: readonly CandidateRun[],
) {
  if (runs[0]?.header.split === "held_out") {
    const dataset = await loadHeldOutSpeech({
      dataDir: options.dataDir,
      splitsPath: options.speechSplitsPath,
      readBytes: options.io.readBytes,
    });
    const ids = dataset.clips.map((clip) => clip.id);
    validateFacts(runs, {
      ids,
      manifestSha256: dataset.manifestSha256,
      splitSha256: dataset.splitSha256,
      receiptSplitSha256: dataset.splitSha256,
    });
    return { ids, clips: dataset.clips, splitHash: dataset.splitSha256 };
  }
  const parsed = speechSplitsSchema.safeParse(
    await readJson(options, options.speechSplitsPath),
  );
  check(parsed.success, "Invalid speech split manifest");
  const split = parsed.data;
  const splitHash = sha256Hex(
    JSON.stringify(split.screening.map(([id, audioHash]) => [id, audioHash])),
  );
  check(splitHash === split.screening_sha256, "Speech split hash mismatch");
  const dataset = await options.io.loadMixat(options.dataDir);
  const ids = split.screening.map(([id]) => id);
  check(
    JSON.stringify([...ids].sort()) ===
      JSON.stringify([...dataset.screeningIds].sort()),
    "Speech screening membership differs from frozen split",
  );
  check(
    split.sources.find((source) => source.name === "mixat")?.manifest_sha256 ===
      dataset.manifestSha256,
    "Speech source manifest hash mismatch",
  );
  validateFacts(runs, {
    ids,
    manifestSha256: dataset.manifestSha256,
    splitSha256: splitHash,
    receiptSplitSha256: dataset.splitSha256,
  });
  const byId = new Map(dataset.labels.map((label) => [label.id, label]));
  const clips = split.screening.map(([id, , language]) => {
    const label = byId.get(id);
    check(label?.language === language, `Speech label metadata differs: ${id}`);
    return label;
  });
  return { ids, clips, splitHash };
}

async function speechTables(
  options: ScoreRunOptions,
  runs: readonly CandidateRun[],
  limitations: readonly string[],
): Promise<Tables> {
  const { ids, clips, splitHash } = await speechDataset(options, runs);
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const scores = runs.map((run) => ({
    candidateId: run.header.candidateId,
    ...scoreSpeech(
      clips.map((clip) => {
        const entry = run.final.get(clip.id);
        if (entry === undefined)
          return {
            clipId: clip.id,
            language: clip.language,
            reference: clip.transcript,
            hypothesis: null,
            status: "not_run",
          };
        const raw = speechRaw.safeParse(entry.raw);
        check(raw.success, `Invalid speech output for ${clip.id}`);
        check(
          raw.data.status === "ok" ? raw.data.text !== null : true,
          `Missing successful speech output for ${clip.id}`,
        );
        return {
          clipId: clip.id,
          language: clip.language,
          reference: clip.transcript,
          hypothesis: raw.data.text,
          status: raw.data.status,
        };
      }),
    ),
  }));
  const best = [...scores].sort(
    (a, b) =>
      (a.summary.wer?.estimate ?? Infinity) -
      (b.summary.wer?.estimate ?? Infinity),
  )[0];
  check(
    best?.summary.wer !== null && best !== undefined,
    "Speech split has no reference words",
  );
  const decisions = applyScreeningRules({
    candidates: scores.map((score) => ({
      candidateId: score.candidateId,
      schemaValidRate: (score.summary.statusCounts.ok ?? 0) / ids.length,
      primary: score.summary.wer?.estimate ?? 0,
      criticalFailures: 0,
    })),
    margin: { kind: "relative", value: 0.1, higherIsBetter: false },
  });
  const compared = scores.map((score) => ({
    ...score,
    bestCandidateId: best.candidateId,
    differenceToBest: compareSpeechCandidates(score.clips, best.clips),
  }));
  const audioSeconds = clips.reduce(
    (total, clip) => total + clip.duration_ms / 1000,
    0,
  );
  const summary = compared.map((score, index) => {
    const run = runs[index];
    check(run !== undefined, "Missing candidate run");
    const { statusCounts, ...base } = operational(run, ids);
    const factors = run.calls
      .filter((call) => call.status === "ok")
      .flatMap((call) => {
        const duration = byId.get(call.itemId)?.duration_ms ?? 0;
        return duration > 0 ? [call.latencyMs / duration] : [];
      });
    return {
      ...base,
      ...statusCounts,
      ...intervalCells("wer", score.summary.wer),
      ...intervalCells("cer", score.summary.cer),
      wer_arabic: score.summary.perLanguageWer.Arabic?.estimate ?? null,
      wer_code_switched: score.summary.perLanguageWer.CS?.estimate ?? null,
      wer_english: score.summary.perLanguageWer.English?.estimate ?? null,
      difference_to_best: score.differenceToBest?.estimate ?? null,
      difference_low: score.differenceToBest?.lower ?? null,
      difference_high: score.differenceToBest?.upper ?? null,
      audio_seconds: audioSeconds,
      cost_usd_per_1000_audio_minutes:
        audioSeconds === 0 ? null : (base.cost_usd * 60000) / audioSeconds,
      real_time_factor_p50: quantile(factors, 0.5),
      ...decisionCells(decisionFor(decisions, score.candidateId)),
    };
  });
  return {
    summary,
    candidates: { splitSha256: splitHash, scores: compared },
    details: {
      "per-language.csv": {
        columns: ["candidate", "language", "wer", "wer_low", "wer_high"],
        rows: scores.flatMap((score) =>
          Object.entries(score.summary.perLanguageWer).map(
            ([language, value]) => ({
              candidate: score.candidateId,
              language,
              ...intervalCells("wer", value),
            }),
          ),
        ),
      },
      "clip-scores.csv": {
        columns: [
          "candidate",
          "clip_id",
          "language",
          "word_edits",
          "reference_words",
          "character_edits",
          "reference_characters",
          "status",
        ],
        rows: scores.flatMap((score) =>
          score.clips.map((clip) => ({
            candidate: score.candidateId,
            clip_id: clip.clipId,
            language: clip.language,
            word_edits: clip.wordEdits,
            reference_words: clip.referenceWords,
            character_edits: clip.characterEdits,
            reference_characters: clip.referenceCharacters,
            status: clip.status,
          })),
        ),
      },
    },
    report: {
      class: "speech",
      runId: options.runId,
      ...(runs[0]?.header.split === "held_out"
        ? { split: "held_out" as const }
        : {}),
      facts: runs.map(reportFacts),
      limitations,
      candidates: compared.map((score, index) => {
        const run = runs[index];
        check(run !== undefined, "Missing candidate run");
        return {
          ...reportBase(run, ids, decisionFor(decisions, score.candidateId)),
          schemaValidRate: wilsonInterval(
            score.summary.statusCounts.ok ?? 0,
            ids.length,
          ),
          primary: { name: "Pooled WER", interval: score.summary.wer },
          secondaries: {
            CER: score.summary.cer,
            "Paired WER difference to best": score.differenceToBest,
          },
          perLanguageWer: score.summary.perLanguageWer,
        };
      }),
    },
  };
}

const extractionColumns = [
  "candidate",
  "git_sha",
  "registry_sha256",
  "items",
  ...statuses,
  "schema_valid_rate",
  "schema_valid_low",
  "schema_valid_high",
  "field_accuracy",
  "field_accuracy_low",
  "field_accuracy_high",
  "difference_to_best",
  "difference_low",
  "difference_high",
  "missing_field_rate",
  "incorrect_rate",
  "unsupported_fill_rate",
  "unsupported_fill_low",
  "unsupported_fill_high",
  "unavailable_fields",
  "unsupported_fills",
  "distractor_capture_rate",
  "distractor_fields",
  "exact_document_rate",
  "exact_document_low",
  "exact_document_high",
  "arabic_field_accuracy",
  "fabrications",
  "critical_failures",
  "cost_usd",
  "cost_usd_per_1000_items",
  "latency_p50_s",
  "latency_p95_s",
  "screening_decision",
  "screening_reasons",
];
const speechColumns = [
  "candidate",
  "git_sha",
  "registry_sha256",
  "items",
  ...statuses,
  "wer",
  "wer_low",
  "wer_high",
  "cer",
  "cer_low",
  "cer_high",
  "wer_arabic",
  "wer_code_switched",
  "wer_english",
  "difference_to_best",
  "difference_low",
  "difference_high",
  "audio_seconds",
  "cost_usd",
  "cost_usd_per_1000_audio_minutes",
  "latency_p50_s",
  "latency_p95_s",
  "real_time_factor_p50",
  "screening_decision",
  "screening_reasons",
];

function csv(columns: readonly string[], rows: Table): string {
  return renderCsv(
    columns,
    rows.map((row) => columns.map((column) => row[column] ?? null)),
  );
}

async function limitationsFor(
  options: ScoreRunOptions,
  split: RunHeader["split"],
): Promise<readonly string[]> {
  if (options.limitationsPath !== undefined)
    return Buffer.from(await options.io.readBytes(options.limitationsPath))
      .toString("utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  return [
    split === "held_out"
      ? "I evaluate the frozen held-out split."
      : "I evaluate the screening split only.",
    "I report small n, with uncertainty intervals that may be wide.",
    ...(options.classId === "mc1_document_extraction"
      ? ["I use synthetic documents for MC1."]
      : []),
    "I run local candidates on a laptop CPU or GPU.",
  ];
}

/** I validate all inputs before writing deterministic, text-free speech score artefacts. */
export async function scoreRun(
  options: ScoreRunOptions,
): Promise<readonly string[]> {
  check(safeIdSchema.safeParse(options.runId).success, "Invalid run id");
  const directory = join(options.resultsDir, options.runId, options.classId);
  const ids = [
    ...(options.candidateIds ?? (await options.io.listCandidates(directory))),
  ].sort();
  check(
    ids.length > 0 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => safeIdSchema.safeParse(id).success),
    "Invalid candidate selection",
  );
  const runs: CandidateRun[] = [];
  for (const id of ids) runs.push(await readCandidate(options, id));
  const limitations = [
    ...(await limitationsFor(options, runs[0]?.header.split ?? "screening")),
    "I use linear interpolation for latency and real-time-factor quantiles over successful receipts. I show unavailable latency as empty CSV cells and as zero in the report table.",
    "I use the last receipt per item as its final status and include every attempt in total cost. I count every missing receipt as not_run in the full split denominator.",
  ];
  const tables =
    options.classId === "mc1_document_extraction"
      ? await extractionTables(options, runs, limitations)
      : await speechTables(options, runs, limitations);
  const files = new Map<string, string>();
  files.set(
    "summary.csv",
    csv(
      options.classId === "mc1_document_extraction"
        ? extractionColumns
        : speechColumns,
      tables.summary,
    ),
  );
  for (const [name, table] of Object.entries(tables.details))
    files.set(name, csv(table.columns, table.rows));
  files.set(
    "scores.json",
    `${JSON.stringify({ scorerVersion: SCORER_VERSION, runId: options.runId, classId: options.classId, runFacts: runs.map((run) => run.header), summary: tables.summary, details: tables.details, candidates: tables.candidates, report: tables.report }, null, 2)}\n`,
  );
  files.set("report.md", renderScreeningReport(tables.report));
  const paths: string[] = [];
  for (const [name, content] of files) {
    const path = join(directory, name);
    await options.io.writeText(path, content);
    paths.push(path);
  }
  return paths;
}
