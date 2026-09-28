export { normaliseDigits, normaliseText, tokenise } from "./text-normaliser.js";
export { requireValid } from "./validation.js";
export {
  alignSequences,
  wordErrors,
  characterErrors,
} from "./edit-distance.js";
export type { Alignment } from "./edit-distance.js";
export {
  wilsonInterval,
  createSeededRandom,
  clusterBootstrapRatio,
  pairedBootstrapDifference,
} from "./statistics.js";
export type {
  Interval,
  RatioCluster,
  RatioPair,
  BootstrapOptions,
} from "./statistics.js";
export { normaliseFieldValue, fieldValuesMatch } from "./field-values.js";
export type { FieldType, FieldValue } from "./field-values.js";
export { scoreField, scoreDocuments } from "./document-scoring.js";
export type {
  FieldLabel,
  DocumentLabel,
  ExtractedField,
  DocumentResult,
  FieldOutcome,
  Fabrication,
  DocumentScore,
} from "./document-scoring.js";
export { scoreSpeech, compareSpeechCandidates } from "./speech-scoring.js";
export type {
  SpeechClip,
  SpeechClipScore,
  SpeechScore,
} from "./speech-scoring.js";
export { scoreTriage } from "./triage-scoring.js";
export type {
  TriageClassification,
  TriageItem,
  ClassScore,
  TriageScore,
} from "./triage-scoring.js";
export { applyScreeningRules } from "./screening-rules.js";
export type {
  ScreeningCandidate,
  ScreeningMargin,
  ScreeningDecision,
} from "./screening-rules.js";
export {
  renderCsv,
  renderMarkdownTable,
  formatPercent,
  formatInterval,
  renderScreeningReport,
} from "./render.js";
export type {
  TableCell,
  ReportMetric,
  RunFacts,
  ReportCandidate,
  ExtractionReportCandidate,
  SpeechReportCandidate,
  ScreeningReportModel,
} from "./render.js";

/** Identifies the deterministic screening metric definitions. */
export const SCORER_VERSION = "1.2.0";
