import { requireValid } from "./validation.js";
import { fieldValuesMatch } from "./field-values.js";
import type { FieldType, FieldValue } from "./field-values.js";
import { clusterBootstrapRatio, wilsonInterval } from "./statistics.js";
import type { Interval, RatioCluster } from "./statistics.js";

export interface FieldLabel {
  readonly type: FieldType;
  readonly script: "latin" | "arabic" | "neutral";
  readonly condition: "readable" | "absent" | "occluded" | "distractor";
  readonly value: FieldValue;
  readonly decoy: { readonly value: FieldValue } | null;
}

export interface DocumentLabel {
  readonly doc_id: string;
  readonly kind: string;
  readonly fields: Readonly<Record<string, FieldLabel>>;
}

export interface ExtractedField {
  readonly value: FieldValue;
  readonly evidence: unknown;
  readonly null_reason: string | null;
}

export interface DocumentResult {
  readonly candidateId: string;
  readonly doc_id: string;
  readonly status: string;
  readonly output: {
    readonly fields: Readonly<Record<string, ExtractedField>>;
  } | null;
}

export type FieldOutcome =
  | "correct"
  | "incorrect"
  | "missing"
  | "abstained"
  | "unsupported_fill"
  | "distractor_capture";

export interface Fabrication {
  readonly doc_id: string;
  readonly field: string;
  readonly value: FieldValue;
}

export interface DocumentScore {
  readonly candidateId: string;
  readonly documents: number;
  readonly schemaValidDocuments: number;
  readonly readableFields: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly missing: number;
  readonly unavailableFields: number;
  readonly unsupportedFills: number;
  readonly distractorFields: number;
  readonly distractorCaptures: number;
  readonly distractorOtherFills: number;
  readonly exactDocuments: number;
  readonly fieldAccuracy: Interval | null;
  readonly missingFieldRate: Interval | null;
  readonly incorrectRate: Interval | null;
  readonly unsupportedFillRate: Interval | null;
  readonly distractorCaptureRate: Interval | null;
  readonly exactDocumentRate: Interval | null;
  readonly schemaValidRate: Interval | null;
  readonly perFieldAccuracy: Readonly<Record<string, Interval | null>>;
  readonly arabicScriptFieldAccuracy: Interval | null;
  readonly perKindFieldAccuracy: Readonly<Record<string, Interval | null>>;
  readonly fabrications: readonly Fabrication[];
}

/** Classifies a field using raw nonemptiness so malformed fills cannot become abstentions. */
export function scoreField(label: FieldLabel, value: FieldValue): FieldOutcome {
  const empty =
    value === null || (typeof value === "string" && value.trim() === "");
  if (label.condition === "readable")
    return empty
      ? "missing"
      : fieldValuesMatch(label.type, label.value, value)
        ? "correct"
        : "incorrect";
  if (empty) return "abstained";
  if (
    label.condition === "distractor" &&
    label.decoy &&
    fieldValuesMatch(label.type, label.decoy.value, value)
  )
    return "distractor_capture";
  return "unsupported_fill";
}

interface DocumentCounts {
  correct: number;
  incorrect: number;
  missing: number;
  unavailableFields: number;
  unsupportedFills: number;
  distractorFields: number;
  distractorCaptures: number;
  distractorOtherFills: number;
}

function emptyCounts(): DocumentCounts {
  return {
    correct: 0,
    incorrect: 0,
    missing: 0,
    unavailableFields: 0,
    unsupportedFills: 0,
    distractorFields: 0,
    distractorCaptures: 0,
    distractorOtherFills: 0,
  };
}

function countOutcome(
  counts: DocumentCounts,
  label: FieldLabel,
  outcome: FieldOutcome,
): void {
  if (outcome === "correct" || outcome === "incorrect" || outcome === "missing")
    counts[outcome] += 1;
  if (label.condition === "absent" || label.condition === "occluded") {
    counts.unavailableFields += 1;
    if (outcome === "unsupported_fill") counts.unsupportedFills += 1;
  }
  if (label.condition === "distractor") {
    counts.distractorFields += 1;
    if (outcome === "distractor_capture") counts.distractorCaptures += 1;
    if (outcome === "unsupported_fill") counts.distractorOtherFills += 1;
  }
}

function addCluster(
  groups: Map<string, RatioCluster[]>,
  key: string,
  cluster: RatioCluster,
): void {
  const values = groups.get(key) ?? [];
  values.push(cluster);
  groups.set(key, values);
}

function groupedAccuracy(
  groups: ReadonlyMap<string, readonly RatioCluster[]>,
): Readonly<Record<string, Interval | null>> {
  return Object.fromEntries(
    [...groups]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, clusters]) => [key, clusterBootstrapRatio(clusters)]),
  );
}

interface ScoredDocument {
  readonly counts: DocumentCounts;
  readonly valid: boolean;
  readonly arabic: RatioCluster;
  readonly fields: readonly {
    readonly name: string;
    readonly cluster: RatioCluster;
  }[];
  readonly fabrications: readonly Fabrication[];
}

function scoreReturnedField(
  label: FieldLabel,
  value: FieldValue,
  schemaValid: boolean,
): FieldOutcome {
  if (label.condition === "readable")
    return schemaValid ? scoreField(label, value) : "missing";
  return scoreField(label, value);
}

function scoreDocumentFields(
  label: DocumentLabel,
  result: DocumentResult,
): ScoredDocument {
  const output = result.status === "ok" ? result.output : null;
  const counts = emptyCounts();
  const fields: { name: string; cluster: RatioCluster }[] = [];
  const fabrications: Fabrication[] = [];
  let arabicCorrect = 0;
  let arabicReadable = 0;
  for (const [field, truth] of Object.entries(label.fields)) {
    const value = result.output?.fields[field]?.value ?? null;
    const outcome = scoreReturnedField(truth, value, Boolean(output));
    countOutcome(counts, truth, outcome);
    const readable = truth.condition === "readable";
    const correct = outcome === "correct" ? 1 : 0;
    fields.push({
      name: field,
      cluster: { numerator: correct, denominator: readable ? 1 : 0 },
    });
    if (readable && truth.script === "arabic") {
      arabicReadable += 1;
      arabicCorrect += correct;
    }
    if (
      ["unsupported_fill", "distractor_capture"].includes(outcome) &&
      ["money", "date", "id_number"].includes(truth.type)
    ) {
      fabrications.push({ doc_id: label.doc_id, field, value });
    }
  }
  return {
    counts,
    valid: Boolean(output),
    arabic: { numerator: arabicCorrect, denominator: arabicReadable },
    fields,
    fabrications,
  };
}

function scoreCandidate(
  candidateId: string,
  labels: readonly DocumentLabel[],
  results: ReadonlyMap<string, DocumentResult>,
): DocumentScore {
  const counts = emptyCounts();
  let schemaValidDocuments = 0;
  let exactDocuments = 0;
  const accuracy: RatioCluster[] = [];
  const missing: RatioCluster[] = [];
  const incorrect: RatioCluster[] = [];
  const arabic: RatioCluster[] = [];
  const fields = new Map<string, RatioCluster[]>();
  const kinds = new Map<string, RatioCluster[]>();
  const fabrications: Fabrication[] = [];
  for (const label of labels) {
    const result = results.get(label.doc_id);
    if (result === undefined)
      throw new Error(
        `Missing result for ${candidateId}, document ${label.doc_id}.`,
      );
    const scored = scoreDocumentFields(label, result);
    const { counts: local, valid } = scored;
    schemaValidDocuments += valid ? 1 : 0;
    for (const field of scored.fields)
      addCluster(fields, field.name, field.cluster);
    fabrications.push(...scored.fabrications);
    const readable = local.correct + local.incorrect + local.missing;
    const cluster = { numerator: local.correct, denominator: readable };
    accuracy.push(cluster);
    missing.push({ numerator: local.missing, denominator: readable });
    incorrect.push({ numerator: local.incorrect, denominator: readable });
    arabic.push(scored.arabic);
    addCluster(kinds, label.kind, cluster);
    const failures =
      local.incorrect +
      local.missing +
      local.unsupportedFills +
      local.distractorCaptures +
      local.distractorOtherFills;
    exactDocuments += valid && failures === 0 ? 1 : 0;
    counts.correct += local.correct;
    counts.incorrect += local.incorrect;
    counts.missing += local.missing;
    counts.unavailableFields += local.unavailableFields;
    counts.unsupportedFills += local.unsupportedFills;
    counts.distractorFields += local.distractorFields;
    counts.distractorCaptures += local.distractorCaptures;
    counts.distractorOtherFills += local.distractorOtherFills;
  }
  return {
    candidateId,
    documents: labels.length,
    schemaValidDocuments,
    ...counts,
    readableFields: counts.correct + counts.incorrect + counts.missing,
    exactDocuments,
    fieldAccuracy: clusterBootstrapRatio(accuracy),
    missingFieldRate: clusterBootstrapRatio(missing),
    incorrectRate: clusterBootstrapRatio(incorrect),
    unsupportedFillRate: wilsonInterval(
      counts.unsupportedFills,
      counts.unavailableFields,
    ),
    distractorCaptureRate: wilsonInterval(
      counts.distractorCaptures,
      counts.distractorFields,
    ),
    exactDocumentRate: wilsonInterval(exactDocuments, labels.length),
    schemaValidRate: wilsonInterval(schemaValidDocuments, labels.length),
    perFieldAccuracy: groupedAccuracy(fields),
    arabicScriptFieldAccuracy: clusterBootstrapRatio(arabic),
    perKindFieldAccuracy: groupedAccuracy(kinds),
    fabrications,
  };
}

/** Scores flat candidate/document results, requiring exactly one result for every label within each represented candidate. */
export function scoreDocuments(
  labels: readonly DocumentLabel[],
  results: readonly DocumentResult[],
): readonly DocumentScore[] {
  const ids = new Set(labels.map((label) => label.doc_id));
  if (ids.size < labels.length)
    throw new Error("Document labels must have unique ids.");
  if (labels.length > 0 && results.length === 0)
    throw new Error("Missing document results.");
  const candidates = new Map<string, Map<string, DocumentResult>>();
  for (const result of results) {
    requireValid(
      ids.has(result.doc_id),
      `Unexpected document ${result.doc_id}.`,
    );
    const documents =
      candidates.get(result.candidateId) ?? new Map<string, DocumentResult>();
    if (documents.has(result.doc_id))
      throw new Error(
        `Duplicate result for ${result.candidateId}, document ${result.doc_id}.`,
      );
    documents.set(result.doc_id, result);
    candidates.set(result.candidateId, documents);
  }
  return [...candidates].map(([candidateId, documents]) =>
    scoreCandidate(candidateId, labels, documents),
  );
}
