import type { DocumentScore } from "./document-scoring.js";
import type { Interval } from "./statistics.js";
import type { ScreeningDecision } from "./screening-rules.js";
import { requireValid } from "./validation.js";

export type TableCell = string | number | boolean | null;
export type ReportMetric = number | Interval | null;

export interface RunFacts {
  readonly candidateId: string;
  readonly gitCommit: string;
  readonly datasetManifestSha256: string;
  readonly splitSha256: string;
  readonly registrySha256: string;
  readonly scorerVersion: string;
  readonly priceDate: string;
  readonly command: string;
  readonly startedAt: string;
}

export interface ReportCandidate {
  readonly candidateId: string;
  readonly items: number;
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly schemaValidRate: Interval | null;
  readonly primary: {
    readonly name: string;
    readonly interval: Interval | null;
  };
  readonly secondaries: Readonly<Record<string, ReportMetric>>;
  readonly totalCostUsd: number;
  readonly p50LatencySeconds: number;
  readonly p95LatencySeconds: number;
  readonly screening: ScreeningDecision;
}

export interface ExtractionReportCandidate extends ReportCandidate {
  readonly extraction: Pick<
    DocumentScore,
    "perFieldAccuracy" | "perKindFieldAccuracy" | "fabrications"
  > & {
    readonly perKindCounts: Readonly<
      Record<
        string,
        {
          readonly documents: number;
          readonly not_run: number;
          readonly readable_fields: number;
        }
      >
    >;
  };
}

export interface SpeechReportCandidate extends ReportCandidate {
  readonly perLanguageWer: Readonly<Record<string, Interval | null>>;
}

export type ScreeningReportModel = {
  readonly split?: "screening" | "held_out";
  readonly runId: string;
  readonly facts: readonly RunFacts[];
  readonly limitations: readonly string[];
} & (
  | {
      readonly class: "extraction";
      readonly candidates: readonly ExtractionReportCandidate[];
    }
  | {
      readonly class: "speech";
      readonly candidates: readonly SpeechReportCandidate[];
    }
  | {
      readonly class: "triage";
      readonly candidates: readonly ReportCandidate[];
    }
);

function cellText(value: TableCell): string {
  return value === null ? "" : String(value);
}

function validateRows(
  columns: readonly string[],
  rows: readonly (readonly TableCell[])[],
): void {
  requireValid(
    columns.length > 0 && rows.every((row) => row.length === columns.length),
    "Tables require columns and rows of matching width.",
  );
}

function csvCell(value: TableCell): string {
  const text = cellText(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** Renders a header and rows with RFC 4180 quoting and newline record separators. */
export function renderCsv(
  columns: readonly string[],
  rows: readonly (readonly TableCell[])[],
): string {
  validateRows(columns, rows);
  return (
    [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") +
    "\n"
  );
}

function markdownText(value: TableCell): string {
  return cellText(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\")
    .replace(/([|`*_[\]{}])/gu, "\\$1")
    .replace(/\r\n|\r|\n/gu, "<br>");
}

/** Renders an aligned Markdown pipe table with escaped cells and a trailing newline. */
export function renderMarkdownTable(
  columns: readonly string[],
  rows: readonly (readonly TableCell[])[],
): string {
  validateRows(columns, rows);
  const escaped = [columns, ...rows].map((row) => row.map(markdownText));
  const widths = columns.map((_, index) =>
    Math.max(3, ...escaped.map((row) => (row[index] ?? "").length)),
  );
  const line = (row: readonly string[]): string =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 3)).join(" | ")} |`;
  const header = escaped[0] ?? [];
  return (
    [
      line(header),
      line(widths.map((width) => "-".repeat(width))),
      ...escaped.slice(1).map(line),
    ].join("\n") + "\n"
  );
}

/** Formats a proportion as a percentage, using N/A for an undefined estimate. */
export function formatPercent(value: number | null, digits?: number): string {
  const places = digits ?? 1;
  requireValid(
    Number.isInteger(places) && places >= 0 && places <= 100,
    "Percentage digits must be an integer from zero to 100.",
  );
  if (value === null) return "N/A";
  requireValid(Number.isFinite(value), "Percentage must be finite.");
  return `${(value * 100).toFixed(places)}%`;
}

/** Formats interval bounds as percentages or N/A when the interval is undefined. */
export function formatInterval(interval: Interval | null): string {
  return interval === null
    ? "N/A"
    : `[${formatPercent(interval.lower)}, ${formatPercent(interval.upper)}]`;
}

function metric(value: ReportMetric): string {
  if (value === null || typeof value === "number") return formatPercent(value);
  return `${formatPercent(value.estimate)} ${formatInterval(value)}`;
}

function entries<T>(
  values: Readonly<Record<string, T>>,
): readonly (readonly [string, T])[] {
  return Object.entries(values).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function factsTable(facts: readonly RunFacts[]): string {
  return renderMarkdownTable(
    [
      "Candidate",
      "Git commit",
      "Dataset manifest SHA-256",
      "Split SHA-256",
      "Registry SHA-256",
      "Scorer version",
      "Price date",
      "Command",
      "Started at",
    ],
    facts.map((fact) => [
      fact.candidateId,
      fact.gitCommit,
      fact.datasetManifestSha256,
      fact.splitSha256,
      fact.registrySha256,
      fact.scorerVersion,
      fact.priceDate,
      fact.command,
      fact.startedAt,
    ]),
  );
}

function summaryTable(candidates: readonly ReportCandidate[]): string {
  return renderMarkdownTable(
    [
      "Candidate",
      "Items",
      "Status counts",
      "Schema-valid rate",
      "Primary metric",
      "Secondaries",
      "Total cost (USD)",
      "p50 latency (s)",
      "p95 latency (s)",
    ],
    candidates.map((candidate) => [
      candidate.candidateId,
      candidate.items,
      entries(candidate.statusCounts)
        .map(([status, count]) => `${status}: ${String(count)}`)
        .join("; "),
      metric(candidate.schemaValidRate),
      `${candidate.primary.name}: ${metric(candidate.primary.interval)}`,
      entries(candidate.secondaries)
        .map(([name, value]) => `${name}: ${metric(value)}`)
        .join("; "),
      candidate.totalCostUsd.toFixed(4),
      candidate.p50LatencySeconds.toFixed(3),
      candidate.p95LatencySeconds.toFixed(3),
    ]),
  );
}

function extractionTables(
  candidates: readonly ExtractionReportCandidate[],
): string[] {
  const fields = candidates.flatMap((candidate) =>
    entries(candidate.extraction.perFieldAccuracy).map(([field, value]) => [
      candidate.candidateId,
      field,
      metric(value),
    ]),
  );
  const kinds = candidates.flatMap((candidate) =>
    entries(candidate.extraction.perKindFieldAccuracy).map(([kind, value]) => [
      candidate.candidateId,
      kind,
      candidate.extraction.perKindCounts[kind]?.documents ?? null,
      candidate.extraction.perKindCounts[kind]?.not_run ?? null,
      candidate.extraction.perKindCounts[kind]?.readable_fields ?? null,
      metric(value),
    ]),
  );
  const fabrications = candidates.flatMap((candidate) =>
    candidate.extraction.fabrications.map((item) => [
      candidate.candidateId,
      item.doc_id,
      item.field,
      item.value,
    ]),
  );
  return [
    "## Per-field accuracy",
    renderMarkdownTable(["Candidate", "Field", "Accuracy"], fields),
    "## Per-kind accuracy",
    renderMarkdownTable(
      [
        "Candidate",
        "Kind",
        "Documents",
        "Not run",
        "Readable fields",
        "Accuracy",
      ],
      kinds,
    ),
    "## Fabrications",
    fabrications.length === 0
      ? "No fabrications were recorded."
      : renderMarkdownTable(
          ["Candidate", "Document", "Field", "Returned value"],
          fabrications,
        ),
  ];
}

/** Renders screening facts, candidate metrics, decisions, class breakdowns and caller-supplied limitations. */
export function renderScreeningReport(model: ScreeningReportModel): string {
  const heldOut = model.split === "held_out";
  const sections = [
    `# ${markdownText(model.class)} ${heldOut ? "held-out" : "screening"} report: ${markdownText(model.runId)}`,
    heldOut
      ? "I report the frozen held-out results as my primary figures. I record product selection and screening comparisons in [my class decision record](decision.md)."
      : "I report these screening results on the screening split; headline figures come only from the held-out split.",
    "## Run facts",
    factsTable(model.facts),
    "## Candidate summary",
    summaryTable(model.candidates),
    heldOut ? "## Existing rejection-rule checks" : "## Screening decisions",
    renderMarkdownTable(
      ["Candidate", "Decision", "Reasons"],
      model.candidates.map((candidate) => {
        requireValid(
          candidate.screening.candidateId === candidate.candidateId,
          "Screening decision candidate does not match the summary.",
        );
        return [
          candidate.candidateId,
          candidate.screening.decision,
          candidate.screening.reasons.join(" ") ||
            "All screening gates passed.",
        ];
      }),
    ),
  ];
  if (model.class === "extraction")
    sections.push(...extractionTables(model.candidates));
  if (model.class === "speech")
    sections.push(
      "## Per-language WER",
      renderMarkdownTable(
        ["Candidate", "Language", "WER"],
        model.candidates.flatMap((candidate) =>
          entries(candidate.perLanguageWer).map(([language, value]) => [
            candidate.candidateId,
            language,
            metric(value),
          ]),
        ),
      ),
    );
  sections.push(
    "## Limitations",
    model.limitations.length === 0
      ? "No limitations were supplied."
      : model.limitations
          .map((limitation) => `- ${markdownText(limitation)}`)
          .join("\n"),
  );
  return sections.map((section) => section.trimEnd()).join("\n\n") + "\n";
}
