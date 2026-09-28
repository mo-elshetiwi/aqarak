import { describe, expect, it } from "vitest";
import {
  formatInterval,
  formatPercent,
  renderCsv,
  renderMarkdownTable,
  renderScreeningReport,
} from "./render.js";
import type { ExtractionReportCandidate, RunFacts } from "./render.js";
import { SCORER_VERSION } from "./index.js";

describe("table renderers", () => {
  it("quotes CSV commas, double quotes and newlines with a header first", () => {
    expect(
      renderCsv(
        ["Name", "Value"],
        [
          ["a,b", 'a"b'],
          ["line\nnext", null],
          ["carriage\rreturn", 0],
          [true, "عربي"],
        ],
      ),
    ).toBe(
      'Name,Value\n"a,b","a""b"\n"line\nnext",\n"carriage\rreturn",0\ntrue,عربي\n',
    );
  });
  it("quotes CSV headers and preserves empty fields", () => {
    expect(renderCsv(["a,b", "c"], [["", ""]])).toBe('"a,b",c\n,\n');
  });
  it("renders aligned Markdown pipes", () => {
    expect(renderMarkdownTable(["Name", "Count"], [["a", 2]])).toBe(
      "| Name | Count |\n| ---- | ----- |\n| a    | 2     |\n",
    );
  });
  it("escapes Markdown cells, HTML and line breaks", () => {
    const table = renderMarkdownTable(["Heading|x"], [["a|b\\c\n<x>&_*[z]`"]]);
    expect(table).toContain("Heading\\|x");
    expect(table).toContain("a\\|b\\\\c<br>&lt;x&gt;&amp;\\_\\*\\[z\\]\\`");
  });
  it("rejects inconsistent table widths", () => {
    expect(() => renderCsv(["a"], [[1, 2]])).toThrow(RangeError);
    expect(() => renderMarkdownTable([], [])).toThrow(RangeError);
  });
  it("formats percentages and intervals only at rendering time", () => {
    expect(formatPercent(1 / 3)).toBe("33.3%");
    expect(formatPercent(1 / 3, 2)).toBe("33.33%");
    expect(formatPercent(null)).toBe("N/A");
    expect(formatInterval({ estimate: 0.8, lower: 0.548, upper: 0.93 })).toBe(
      "[54.8%, 93.0%]",
    );
    expect(formatInterval(null)).toBe("N/A");
    expect(() => formatPercent(NaN)).toThrow(RangeError);
    expect(() => formatPercent(1, -1)).toThrow(RangeError);
  });
});

describe("renderScreeningReport", () => {
  const interval = { estimate: 0.8, lower: 0.6, upper: 0.9 };
  const facts: RunFacts = {
    candidateId: "candidate-a",
    gitCommit: "abc1234",
    datasetManifestSha256: "manifest-hash",
    splitSha256: "split-hash",
    registrySha256: "registry-hash",
    scorerVersion: SCORER_VERSION,
    priceDate: "2026-09-28",
    command: "pnpm screen --class extraction",
    startedAt: "2026-09-28T00:00:00Z",
  };
  const first: ExtractionReportCandidate = {
    candidateId: "candidate-a",
    items: 10,
    statusCounts: { ok: 9, failed: 1 },
    schemaValidRate: interval,
    primary: { name: "Field accuracy", interval },
    secondaries: { exact: 0.7, missing: null, accuracy: interval },
    totalCostUsd: 0.123456,
    p50LatencySeconds: 1.25,
    p95LatencySeconds: 2.75,
    screening: {
      candidateId: "candidate-a",
      decision: "rejected",
      reasons: ["Schema-valid rate 0.8 is below 0.95."],
    },
    extraction: {
      perFieldAccuracy: { rent: interval },
      perKindFieldAccuracy: { lease: interval },
      perKindCounts: {
        lease: { documents: 10, not_run: 0, readable_fields: 20 },
      },
      fabrications: [{ doc_id: "doc-1", field: "rent", value: "AED 500" }],
    },
  };
  it("renders screening statement, run facts, candidate summary rows and decisions", () => {
    const second: ExtractionReportCandidate = {
      ...first,
      candidateId: "candidate-b",
      screening: {
        candidateId: "candidate-b",
        decision: "survives",
        reasons: [],
      },
    };
    const report = renderScreeningReport({
      class: "extraction",
      runId: "run-1",
      facts: [
        facts,
        {
          ...facts,
          candidateId: "candidate-b",
          gitCommit: "def5678",
          registrySha256: "second-registry-hash",
          command: "pnpm screen --candidate candidate-b",
          startedAt: "2026-09-28T01:00:00Z",
        },
      ],
      candidates: [first, second],
      limitations: ["I used a small screening sample."],
    });
    expect(report).toContain("# extraction screening report: run-1");
    expect(report).toContain(
      "screening results on the screening split; headline figures come only from the held-out split.",
    );
    for (const heading of [
      "Run facts",
      "Candidate summary",
      "Screening decisions",
      "Per-field accuracy",
      "Per-kind accuracy",
      "Fabrications",
      "Limitations",
    ])
      expect(report).toContain(`## ${heading}`);
    for (const value of Object.values(facts)) expect(report).toContain(value);
    const runFacts = report
      .split("## Run facts\n\n")[1]
      ?.split("## Candidate summary")[0];
    const factRows = runFacts
      ?.split("\n")
      .filter((line) => line.startsWith("| candidate-"));
    expect(factRows).toHaveLength(2);
    expect(factRows?.[0]).toContain("abc1234");
    expect(factRows?.[1]).toContain("def5678");
    expect(factRows?.[1]).toContain("second-registry-hash");
    expect(factRows?.[1]).toContain("pnpm screen --candidate candidate-b");
    expect(factRows?.[1]).toContain("2026-09-28T01:00:00Z");
    const summary =
      report
        .split("## Candidate summary\n\n")[1]
        ?.split("## Screening decisions")[0] ?? "";
    expect(
      summary.split("\n").filter((line) => line.startsWith("| candidate-")),
    ).toHaveLength(2);
    expect(summary).toContain("failed: 1; ok: 9");
    expect(summary).toContain("80.0% \\[60.0%, 90.0%\\]");
    expect(summary).toContain("Field accuracy: 80.0%");
    expect(summary).toContain("exact: 70.0%; missing: N/A");
    expect(summary).toContain("0.1235");
    expect(summary).toContain("1.250");
    expect(summary).toContain("2.750");
    expect(report).toContain("rejected");
    expect(report).toContain("survives");
    expect(report).toContain("Schema-valid rate 0.8 is below 0.95.");
    expect(report).toContain("All screening gates passed.");
    expect(report).toContain("rent");
    expect(report).toContain("lease");
    expect(report).toContain("AED 500");
    expect(report).toContain("- I used a small screening sample.");
    expect(report).not.toContain("\u2014");
  });
  it("renders speech language metrics and undefined intervals", () => {
    const report = renderScreeningReport({
      class: "speech",
      runId: "speech-1",
      facts: [facts],
      candidates: [
        {
          ...first,
          schemaValidRate: null,
          primary: { name: "WER", interval: null },
          perLanguageWer: { Arabic: interval, English: null },
        },
      ],
      limitations: [],
    });
    expect(report).toContain("## Per-language WER");
    expect(report).toContain("Arabic");
    expect(report).toContain("English");
    expect(report).toContain("WER: N/A");
    expect(report).toContain("No limitations were supplied.");
  });
  it("renders triage without extraction or speech breakdowns", () => {
    const report = renderScreeningReport({
      class: "triage",
      runId: "t1",
      facts: [facts],
      candidates: [first],
      limitations: [],
    });
    expect(report).toContain("# triage");
    expect(report).not.toContain("## Fabrications");
    expect(report).not.toContain("## Per-language WER");
  });
  it("reports an empty fabrication list and validates decision identity", () => {
    expect(
      renderScreeningReport({
        class: "extraction",
        runId: "x",
        facts: [],
        candidates: [],
        limitations: [],
      }),
    ).toContain("No fabrications were recorded.");
    expect(() =>
      renderScreeningReport({
        class: "triage",
        runId: "x",
        facts: [facts],
        candidates: [
          { ...first, screening: { ...first.screening, candidateId: "wrong" } },
        ],
        limitations: [],
      }),
    ).toThrow("does not match");
  });
  it("exports the scorer version", () => {
    expect(SCORER_VERSION).toBe("1.2.0");
  });
});
