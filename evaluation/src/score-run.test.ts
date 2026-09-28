import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256Hex, ZERO_USAGE } from "@aqarak/api/models";
import { loadSyntheticDocs, loadSplits } from "./datasets/synthetic-docs";
import { loadMixat } from "./datasets/mixat";
import type { MixatDataset } from "./datasets/mixat";
import { readReceipts } from "./receipts";
import type { CallReceipt, RunHeader } from "./receipts";
import { temporaryDirectory, writeSyntheticFixture } from "./test-fixtures";
import { scoreRun } from "./score-run";
import type { ScoreRunOptions, ScoreClass } from "./score-run";
import { parseScoreArguments } from "./cli/score";
import { pairedBootstrapDifference } from "./scoring/statistics";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(classId: ScoreClass = "mc1_document_extraction") {
  const root = await temporaryDirectory();
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const memory = new Map<string, Uint8Array>();
  const written = new Map<string, string>();
  const options: ScoreRunOptions = {
    runId: "score-fixture",
    classId,
    repositoryRoot,
    resultsDir: join(repositoryRoot, "results"),
    syntheticDir: join(root, "synthetic"),
    speechSplitsPath: join(root, "speech-splits.json"),
    dataDir: join(root, "data"),
    privateRunsDir: "/virtual/private-runs",
    io: {
      readBytes: (path) =>
        memory.has(path)
          ? Promise.resolve(memory.get(path) ?? new Uint8Array())
          : readFile(path),
      async writeText(path, text) {
        written.set(path, text);
        await writeFile(path, text);
      },
      realpath: (path) =>
        path.startsWith("/virtual/") ? Promise.resolve(path) : realpath(path),
      readReceipts,
      loadSyntheticDocs,
      loadSplits,
      loadMixat,
      async listCandidates(directory) {
        const candidates: string[] = [];
        for (const entry of await readdir(directory, { withFileTypes: true }))
          if (
            entry.isDirectory() &&
            (await readdir(join(directory, entry.name))).includes(
              "receipts.jsonl",
            )
          )
            candidates.push(entry.name);
        return candidates;
      },
    },
  };
  await mkdir(repositoryRoot);
  await mkdir(join(options.resultsDir, options.runId, classId), {
    recursive: true,
  });
  return { options, memory, written };
}

function header(
  options: ScoreRunOptions,
  candidateId: string,
  manifestSha256: string,
  splitSha256: string,
): RunHeader {
  return {
    record: "run",
    runId: options.runId,
    classId: options.classId,
    candidateId,
    split: "screening",
    gitSha: "a".repeat(40),
    datasetManifestSha256: manifestSha256,
    splitSha256,
    registrySha256: "b".repeat(64),
    scorerVersion: null,
    command: "screen fixture",
    priceDate: "2026-09-28",
    startedAt: "2026-09-28T00:00:00Z",
  };
}

function call(
  options: ScoreRunOptions,
  candidateId: string,
  itemId: string,
  output: {
    readonly status: CallReceipt["status"];
    readonly raw: string;
    readonly rawOutputPath: string;
  },
): CallReceipt {
  const { status, raw, rawOutputPath } = output;
  return {
    record: "call",
    runId: options.runId,
    classId: options.classId,
    candidateId,
    itemId,
    provider: "openai_responses",
    modelId: "fixture",
    modelVersion: null,
    modelEcho: null,
    parameters: {},
    parametersSha256: sha256Hex("{}"),
    promptId: null,
    promptVersion: null,
    promptSha256: null,
    schemaId: null,
    schemaSha256: null,
    inputSha256: "c".repeat(64),
    outputSha256: null,
    usage: ZERO_USAGE,
    latencyMs: 1000,
    costMicroUsd: 10000,
    schemaValid: status === "ok",
    retries: 0,
    transportRetries: 0,
    status,
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-09-28T00:00:00Z",
    finishedAt: "2026-09-28T00:00:01Z",
    rawOutputPath,
    rawOutputSha256: sha256Hex(raw),
  };
}

async function writeReceipts(
  options: ScoreRunOptions,
  run: RunHeader,
  calls: readonly CallReceipt[],
) {
  const directory = join(
    options.resultsDir,
    options.runId,
    options.classId,
    run.candidateId,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "receipts.jsonl"),
    [run, ...calls].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

async function extractionFixture() {
  const setup = await fixture();
  const { options } = setup;
  await writeSyntheticFixture(options.syntheticDir);
  const original = await loadSyntheticDocs(options.syntheticDir);
  const labels = original.map((document) => ({
    ...document,
    fields: Object.fromEntries(
      Object.entries(document.fields).map(([name, field]) => [
        name,
        {
          ...field,
          script: name === "name_ar" ? "arabic" : "neutral",
          condition: ["id_number", "name_ar"].includes(name)
            ? "readable"
            : "absent",
          value:
            name === "id_number" ? "123" : name === "name_ar" ? "محمد" : null,
        },
      ]),
    ),
  }));
  await writeFile(
    join(options.syntheticDir, "labels.jsonl"),
    labels.map((label) => JSON.stringify(label)).join("\n") + "\n",
  );
  const splits = await loadSplits(options.syntheticDir);
  const manifest = sha256Hex(
    await readFile(join(options.syntheticDir, "manifest.json")),
  );
  for (const candidate of ["a", "b"]) {
    const calls: CallReceipt[] = [];
    for (const [index, label] of labels.entries()) {
      if (candidate === "b" && index === 2) continue;
      const status = candidate === "b" && index === 1 ? "schema_invalid" : "ok";
      const fields = Object.fromEntries(
        Object.entries(label.fields).map(([name, field]) => [
          name,
          {
            value:
              candidate === "b" && name === "id_number"
                ? "999"
                : candidate === "b" && name === "date_of_birth"
                  ? "2000-01-01"
                  : field.value,
            evidence: null,
            null_reason: field.value === null ? "absent" : null,
          },
        ]),
      );
      const raw = JSON.stringify({
        itemId: label.doc_id,
        candidateId: candidate,
        status,
        output: status === "ok" ? { fields } : null,
      });
      const path = join(
        options.resultsDir,
        options.runId,
        options.classId,
        candidate,
        "raw",
        `${label.doc_id}.json`,
      );
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, raw);
      calls.push({
        ...call(options, candidate, label.doc_id, {
          status,
          raw,
          rawOutputPath: relative(options.repositoryRoot, path),
        }),
        promptSha256: sha256Hex("extraction prompt"),
        schemaSha256: sha256Hex("extraction schema"),
        latencyMs: (index + 1) * 1000,
      });
    }
    await writeReceipts(
      options,
      header(options, candidate, manifest, splits.screening_sha256),
      calls,
    );
  }
  return { ...setup, labels };
}

async function pairedExtractionFixture(
  correct: Readonly<Record<"a" | "b", readonly (number | null)[]>>,
) {
  const setup = await extractionFixture();
  const documents = await loadSyntheticDocs(setup.options.syntheticDir);
  const readable = [1, 2, 4];
  const labels = documents.map((document, index) => {
    const template = Object.values(document.fields)[0];
    if (template === undefined) throw new Error("Missing fixture field");
    return {
      ...document,
      fields: Object.fromEntries(
        Array.from({ length: readable[index] ?? 0 }, (_, field) => [
          `field_${String(field)}`,
          {
            ...template,
            type: "text" as const,
            script: "latin" as const,
            condition: "readable" as const,
            value: "expected",
          },
        ]),
      ),
    };
  });
  const options: ScoreRunOptions = {
    ...setup.options,
    io: {
      ...setup.options.io,
      loadSyntheticDocs: () => Promise.resolve(labels),
    },
  };
  for (const candidate of ["a", "b"] as const) {
    const directory = join(
      options.resultsDir,
      options.runId,
      options.classId,
      candidate,
    );
    const run = (await readReceipts(join(directory, "receipts.jsonl")))[0];
    if (run?.record === undefined || run.record === "call")
      throw new Error("Missing fixture header");
    const calls: CallReceipt[] = [];
    for (const [index, label] of labels.entries()) {
      const count = correct[candidate][index];
      if (count === null) continue;
      if (count === undefined) throw new Error("Missing fixture count");
      const fields = Object.fromEntries(
        Object.keys(label.fields).map((name, field) => [
          name,
          {
            value: field < count ? "expected" : "incorrect",
            evidence: null,
            null_reason: null,
          },
        ]),
      );
      const raw = JSON.stringify({
        itemId: label.doc_id,
        candidateId: candidate,
        status: "ok",
        output: { fields },
      });
      const path = join(directory, "raw", `${label.doc_id}.json`);
      await writeFile(path, raw);
      calls.push({
        ...call(options, candidate, label.doc_id, {
          status: "ok",
          raw,
          rawOutputPath: relative(options.repositoryRoot, path),
        }),
        promptSha256: sha256Hex("extraction prompt"),
        schemaSha256: sha256Hex("extraction schema"),
      });
    }
    await writeReceipts(options, run, calls);
  }
  return { ...setup, options };
}

async function speechFixture() {
  const setup = await fixture("mc3_speech_to_text");
  const { memory } = setup;
  const references = ["باب دار", "blue باب", "green fox"];
  const hypotheses = [
    ["باب دار", "blue باب", "green box"],
    ["باب نار", "blue", null],
  ];
  const languages = ["Arabic", "CS", "English"];
  const entries = languages.map((language, index) => [
    `clip-${String(index + 1)}`,
    "d".repeat(64),
    language,
  ]);
  const manifestSha256 = sha256Hex("speech fixture manifest");
  const splitBytes = Buffer.from("clip-1\nclip-2\nclip-3\n");
  const splitHash = sha256Hex(
    JSON.stringify(entries.map(([id, audioHash]) => [id, audioHash])),
  );
  const dataset: MixatDataset = {
    directory: "/virtual/data/mixat",
    manifestSha256,
    splitSha256: sha256Hex(splitBytes),
    screeningIds: ["clip-1", "clip-2", "clip-3"],
    labels: references.map((transcript, index) => ({
      id: `clip-${String(index + 1)}`,
      part: 2,
      file: `clip-${String(index + 1)}.wav`,
      split: "screening",
      language: languages[index] ?? "English",
      duration_ms: 10000,
      transcript,
    })),
  };
  const options: ScoreRunOptions = {
    ...setup.options,
    io: { ...setup.options.io, loadMixat: () => Promise.resolve(dataset) },
  };
  memory.set(
    options.speechSplitsPath,
    Buffer.from(
      JSON.stringify({
        dataset: "speech-splits-v1",
        screening: entries,
        screening_sha256: splitHash,
        sources: [{ name: "mixat", manifest_sha256: manifestSha256 }],
      }),
    ),
  );
  for (const [candidateIndex, candidate] of ["a", "b"].entries()) {
    const calls: CallReceipt[] = [];
    for (const [index, label] of dataset.labels.entries()) {
      const text = hypotheses[candidateIndex]?.[index] ?? null;
      const status = text === null ? "timeout" : "ok";
      const raw = JSON.stringify({
        itemId: label.id,
        candidateId: candidate,
        status,
        text,
      });
      const relativePath = `${options.runId}/${options.classId}/${candidate}/raw/${label.id}.json`;
      memory.set(join(options.privateRunsDir, relativePath), Buffer.from(raw));
      calls.push(
        call(options, candidate, label.id, {
          status,
          raw,
          rawOutputPath: `private-runs:${relativePath}`,
        }),
      );
    }
    await writeReceipts(
      options,
      header(options, candidate, manifestSha256, dataset.splitSha256),
      calls,
    );
  }
  return { ...setup, options, references, hypotheses, dataset };
}

function file(written: ReadonlyMap<string, string>, name: string): string {
  const entry = [...written].find(([path]) => path.endsWith(`/${name}`));
  if (entry === undefined) throw new Error(`Missing output ${name}`);
  return entry[1];
}

function csvRows(text: string): readonly Readonly<Record<string, string>>[] {
  const lines = text.trim().split("\n");
  const columns = lines.shift()?.split(",") ?? [];
  return lines.map((line) => {
    const cells = line.match(/(?:"(?:[^"]|"")*"|[^,]+|(?<=,)(?=,|$))/gu) ?? [];
    return Object.fromEntries(
      columns.map((column, index) => [
        column,
        cells[index]?.replace(/^"|"$/gu, "").replace(/""/gu, '"') ?? "",
      ]),
    );
  });
}

it("scores an extraction run", async () => {
  const { options, written, labels } = await extractionFixture();
  const files = await scoreRun(options);
  expect(files).toHaveLength(7);
  const rows = csvRows(file(written, "summary.csv"));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    candidate: "a",
    items: "3",
    ok: "3",
    not_run: "0",
    field_accuracy: "1",
    schema_valid_rate: "1",
    exact_document_rate: "1",
    arabic_field_accuracy: "1",
    fabrications: "0",
    cost_usd: "0.03",
    cost_usd_per_1000_items: "10",
    latency_p50_s: "2",
    latency_p95_s: "2.9",
    screening_decision: "survives",
  });
  expect(rows[1]).toMatchObject({
    candidate: "b",
    items: "3",
    ok: "1",
    schema_invalid: "1",
    not_run: "1",
    field_accuracy: String(1 / 6),
    schema_valid_rate: String(1 / 3),
    missing_field_rate: String(4 / 6),
    incorrect_rate: String(1 / 6),
    exact_document_rate: "0",
    arabic_field_accuracy: String(1 / 3),
    unsupported_fills: "1",
    fabrications: "1",
    cost_usd: "0.02",
    screening_decision: "rejected",
  });
  const unavailable = labels.reduce(
    (total, label) => total + Object.keys(label.fields).length - 2,
    0,
  );
  expect(rows[1]?.unavailable_fields).toBe(String(unavailable));
  expect(rows[1]?.unsupported_fill_rate).toBe(String(1 / unavailable));
  expect(file(written, "document-outcomes.csv")).toContain(
    "b,doc-3,id_number,readable,missing",
  );
  expect(file(written, "fabrications.csv")).toContain(
    "b,doc-1,date_of_birth,date,absent,2000-01-01",
  );
  expect(file(written, "per-field.csv")).toContain(
    "b,emirates_id,name_ar,name,arabic,3,1,0.3333333333333333",
  );
  const report = file(written, "report.md");
  expect(report).toContain(
    "headline figures come only from the held-out split",
  );
  expect(report).toContain("survives");
  expect(report).toContain("rejected");
  expect(report).toContain("not\\_run: 1");
  expect(report).toContain("synthetic documents");
  expect(file(written, "scores.json")).toContain('"scorerVersion": "1.2.0"');
});

it.each(["a", "b"] as const)(
  "reports paired pooled accuracy differences with %s as the best candidate",
  async (best) => {
    const lower = best === "a" ? "b" : "a";
    const { options, written } = await pairedExtractionFixture({
      a: best === "a" ? [1, 1, 2] : [0, 2, 1],
      b: best === "b" ? [1, 1, 2] : [0, 2, 1],
    });
    await scoreRun(options);
    const csv = file(written, "summary.csv");
    expect(csv.split("\n")[0]).toContain(
      "field_accuracy_high,difference_to_best,difference_low,difference_high,",
    );
    const rows = csvRows(csv);
    expect(rows.find((row) => row.candidate === best)).toMatchObject({
      field_accuracy: String(4 / 7),
      difference_to_best: "0",
      difference_low: "0",
      difference_high: "0",
    });
    const row = rows.find((entry) => entry.candidate === lower);
    const expected = pairedBootstrapDifference([
      {
        a: { numerator: 0, denominator: 1 },
        b: { numerator: 1, denominator: 1 },
      },
      {
        a: { numerator: 2, denominator: 2 },
        b: { numerator: 1, denominator: 2 },
      },
      {
        a: { numerator: 1, denominator: 4 },
        b: { numerator: 2, denominator: 4 },
      },
    ]);
    expect(row).toMatchObject({
      field_accuracy: String(3 / 7),
      difference_to_best: String(3 / 7 - 4 / 7),
      difference_low: String(expected?.lower),
      difference_high: String(expected?.upper),
    });
    expect(Number(row?.difference_low)).toBeLessThanOrEqual(3 / 7 - 4 / 7);
    expect(Number(row?.difference_high)).toBeGreaterThanOrEqual(3 / 7 - 4 / 7);
    const scored: unknown = JSON.parse(file(written, "scores.json"));
    expect(scored).toHaveProperty(
      "summary",
      expect.arrayContaining([
        expect.objectContaining({
          candidate: lower,
          difference_to_best: 3 / 7 - 4 / 7,
          difference_low: expected?.lower,
          difference_high: expected?.upper,
        }),
      ]),
    );
    expect(scored).toHaveProperty(
      "candidates",
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: lower,
          bestCandidateId: best,
          differenceToBest: expected,
        }),
      ]),
    );
    const report = file(written, "report.md");
    expect(report).toContain(
      "Paired accuracy difference to best: 0.0% \\[0.0%, 0.0%\\]",
    );
    expect(report).toContain(
      `Paired accuracy difference to best: -14.3% \\[${((expected?.lower ?? 0) * 100).toFixed(1)}%, ${((expected?.upper ?? 0) * 100).toFixed(1)}%\\]`,
    );
  },
);

it("includes a missing extraction receipt as zero correct fields in its document pair", async () => {
  const { options, written } = await pairedExtractionFixture({
    a: [1, 1, 2],
    b: [0, 2, null],
  });
  await scoreRun(options);
  const expected = pairedBootstrapDifference([
    {
      a: { numerator: 0, denominator: 1 },
      b: { numerator: 1, denominator: 1 },
    },
    {
      a: { numerator: 2, denominator: 2 },
      b: { numerator: 1, denominator: 2 },
    },
    {
      a: { numerator: 0, denominator: 4 },
      b: { numerator: 2, denominator: 4 },
    },
  ]);
  expect(csvRows(file(written, "summary.csv"))[1]).toMatchObject({
    not_run: "1",
    field_accuracy: String(2 / 7),
    difference_to_best: String(2 / 7 - 4 / 7),
    difference_low: String(expected?.lower),
    difference_high: String(expected?.upper),
  });
});

it("breaks tied extraction accuracies by candidate id and sorts document pairs", async () => {
  const { options, written } = await pairedExtractionFixture({
    a: [1, 1, 2],
    b: [0, 2, 2],
  });
  await scoreRun(options);
  const first = csvRows(file(written, "summary.csv"));
  expect(first[0]).toMatchObject({
    difference_to_best: "0",
    difference_low: "0",
    difference_high: "0",
  });
  expect(Number(first[1]?.difference_low)).toBeLessThan(0);
  expect(Number(first[1]?.difference_high)).toBeGreaterThan(0);
  expect(JSON.parse(file(written, "scores.json"))).toMatchObject({
    candidates: [
      { candidateId: "a", bestCandidateId: "a" },
      { candidateId: "b", bestCandidateId: "a" },
    ],
  });
  await scoreRun({
    ...options,
    candidateIds: ["b", "a"],
    io: {
      ...options.io,
      async loadSplits(directory, documents) {
        const split = await options.io.loadSplits(directory, documents);
        return { ...split, screening: [...split.screening].reverse() };
      },
    },
  });
  const differences = (rows: readonly Readonly<Record<string, string>>[]) =>
    rows.map((row) => [
      row.difference_to_best,
      row.difference_low,
      row.difference_high,
    ]);
  expect(differences(csvRows(file(written, "summary.csv")))).toEqual(
    differences(first),
  );
});

it.each(["date", "money"] as const)(
  "rejects a %s fabrication but retains an identity decoy without a critical failure",
  async (type) => {
    const { options, written } = await extractionFixture();
    const documents = await loadSyntheticDocs(options.syntheticDir);
    const labels = documents.map((document) => ({
      ...document,
      fields: Object.fromEntries(
        Object.entries(document.fields).map(([name, field]) => [
          name,
          name === "id_number" && document.doc_id === "doc-1"
            ? {
                ...field,
                condition: "distractor" as const,
                value: null,
                decoy: {
                  label_en: "Reference",
                  label_ar: "مرجع",
                  printed: "999",
                  value: "999",
                  image_box: null,
                },
              }
            : name === "date_of_birth"
              ? { ...field, type }
              : field,
        ]),
      ),
    }));
    const fabricatedValue = type === "date" ? "2000-01-01" : "500";
    for (const candidate of ["a", "b"]) {
      const directory = join(
        options.resultsDir,
        options.runId,
        options.classId,
        candidate,
      );
      const run = (await readReceipts(join(directory, "receipts.jsonl")))[0];
      if (run?.record !== "run") throw new Error("Missing fixture header");
      const calls: CallReceipt[] = [];
      for (const label of labels) {
        const fields = Object.fromEntries(
          Object.entries(label.fields).map(([name, field]) => [
            name,
            {
              value:
                label.doc_id === "doc-1" &&
                candidate === "a" &&
                name === "id_number"
                  ? "999"
                  : label.doc_id === "doc-1" &&
                      candidate === "b" &&
                      name === "date_of_birth"
                    ? fabricatedValue
                    : field.value,
              evidence: null,
              null_reason: null,
            },
          ]),
        );
        const raw = JSON.stringify({
          itemId: label.doc_id,
          candidateId: candidate,
          status: "ok",
          output: { fields },
        });
        const path = join(directory, "raw", `${label.doc_id}.json`);
        await writeFile(path, raw);
        calls.push({
          ...call(options, candidate, label.doc_id, {
            status: "ok",
            raw,
            rawOutputPath: relative(options.repositoryRoot, path),
          }),
          promptSha256: sha256Hex("extraction prompt"),
          schemaSha256: sha256Hex("extraction schema"),
        });
      }
      await writeReceipts(options, run, calls);
    }
    await scoreRun({
      ...options,
      io: { ...options.io, loadSyntheticDocs: () => Promise.resolve(labels) },
    });
    const summary = file(written, "summary.csv");
    expect(summary.split("\n")[0]).toContain("fabrications,critical_failures,");
    expect(csvRows(summary)).toMatchObject([
      {
        candidate: "a",
        fabrications: "1",
        critical_failures: "0",
        screening_decision: "survives",
        screening_reasons: "",
      },
      {
        candidate: "b",
        fabrications: "1",
        critical_failures: "1",
        screening_decision: "rejected",
        screening_reasons: "Critical failures 1 exceed 0.",
      },
    ]);
    expect(JSON.parse(file(written, "scores.json"))).toMatchObject({
      summary: [
        { candidate: "a", fabrications: 1, critical_failures: 0 },
        { candidate: "b", fabrications: 1, critical_failures: 1 },
      ],
    });
    expect(csvRows(file(written, "fabrications.csv"))).toEqual([
      {
        candidate: "a",
        doc_id: "doc-1",
        field: "id_number",
        type: "id_number",
        condition: "distractor",
        returned_value: "999",
      },
      {
        candidate: "b",
        doc_id: "doc-1",
        field: "date_of_birth",
        type,
        condition: "absent",
        returned_value: fabricatedValue,
      },
    ]);
    const fabrications = file(written, "report.md")
      .split("## Fabrications\n\n")[1]
      ?.split("## Limitations")[0];
    expect(fabrications).toMatch(/\| a +\| doc-1 +\| id\\_number +\| 999/u);
    expect(fabrications).toContain(fabricatedValue);
  },
);

it.each([false, true])(
  "shows per-kind denominators when all receipts are missing: %s",
  async (allMissing) => {
    const { options, written } = await extractionFixture();
    if (allMissing) {
      const path = join(
        options.resultsDir,
        options.runId,
        options.classId,
        "b/receipts.jsonl",
      );
      const run = (await readReceipts(path))[0];
      if (run?.record !== "run") throw new Error("Missing fixture header");
      await writeReceipts(options, run, []);
    }
    await scoreRun(options);
    const perKind = file(written, "per-kind.csv");
    expect(perKind.split("\n")[0]).toBe(
      "candidate,kind,documents,not_run,readable_fields,field_accuracy,field_accuracy_low,field_accuracy_high",
    );
    expect(csvRows(perKind)).toMatchObject([
      {
        candidate: "a",
        kind: "emirates_id",
        documents: "3",
        not_run: "0",
        readable_fields: "6",
        field_accuracy: "1",
      },
      {
        candidate: "b",
        kind: "emirates_id",
        documents: "3",
        not_run: allMissing ? "3" : "1",
        readable_fields: "6",
        field_accuracy: allMissing ? "0" : String(1 / 6),
      },
    ]);
    const table = file(written, "report.md")
      .split("## Per-kind accuracy\n\n")[1]
      ?.split("## Fabrications")[0]
      ?.split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(table?.[0]).toEqual([
      "Candidate",
      "Kind",
      "Documents",
      "Not run",
      "Readable fields",
      "Accuracy",
    ]);
    expect(table?.[2]?.slice(0, 5)).toEqual([
      "a",
      "emirates\\_id",
      "3",
      "0",
      "6",
    ]);
    expect(table?.[3]?.slice(0, 5)).toEqual([
      "b",
      "emirates\\_id",
      "3",
      allMissing ? "3" : "1",
      "6",
    ]);
  },
);

it("refuses tampered raw output", async () => {
  const { options, written } = await extractionFixture();
  const path = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "b/raw/doc-2.json",
  );
  await writeFile(path, "tampered");
  await expect(scoreRun(options)).rejects.toThrow(path);
  expect(written.size).toBe(0);
});

it("scores a speech run without writing text", async () => {
  const { options, written, references, hypotheses } = await speechFixture();
  expect(await scoreRun(options)).toHaveLength(5);
  const rows = csvRows(file(written, "summary.csv"));
  expect(rows[0]).toMatchObject({
    candidate: "a",
    items: "3",
    ok: "3",
    wer: String(1 / 6),
    cer: String(1 / 24),
    difference_to_best: "0",
    difference_low: "0",
    difference_high: "0",
    audio_seconds: "30",
    cost_usd: "0.03",
    cost_usd_per_1000_audio_minutes: "60",
    real_time_factor_p50: "0.1",
    screening_decision: "survives",
  });
  expect(rows[1]).toMatchObject({
    candidate: "b",
    items: "3",
    ok: "2",
    timeout: "1",
    wer: String(4 / 6),
    cer: String(14 / 24),
    difference_to_best: "0.5",
    screening_decision: "rejected",
  });
  expect(Number(rows[1]?.difference_low)).toBeLessThanOrEqual(0.5);
  expect(Number(rows[1]?.difference_high)).toBeGreaterThanOrEqual(0.5);
  expect(file(written, "clip-scores.csv")).toContain(
    "b,clip-3,English,2,2,9,9,timeout",
  );
  expect(file(written, "per-language.csv")).toContain("b,English,1,1,1");
  for (const [path, text] of written) {
    expect(await readFile(path, "utf8")).toBe(text);
    for (const forbidden of [...references, ...hypotheses.flat()])
      if (forbidden !== null) expect(text).not.toContain(forbidden);
  }
});

it("is reproducible", async () => {
  for (const setup of [await extractionFixture(), await speechFixture()]) {
    await scoreRun(setup.options);
    const first = [...setup.written];
    setup.written.clear();
    await scoreRun(setup.options);
    expect([...setup.written]).toEqual(first);
  }
});

it("selects candidates and reads supplied limitations", async () => {
  const { options, written } = await extractionFixture();
  const path = join(options.repositoryRoot, "limitations.txt");
  await writeFile(
    path,
    "I restrict this fixture to three documents.\n\nI have no held-out estimates.\n",
  );
  await scoreRun({ ...options, candidateIds: ["b"], limitationsPath: path });
  expect(csvRows(file(written, "summary.csv"))).toHaveLength(1);
  expect(file(written, "report.md")).toContain("I have no held-out estimates.");
  expect(file(written, "report.md")).not.toContain("laptop CPU");
});

it("uses the last attempt but verifies and charges every receipt", async () => {
  const { options, written } = await extractionFixture();
  const path = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "a/receipts.jsonl",
  );
  const receipts = await readReceipts(path);
  const first = receipts[1];
  if (first?.record !== "call") throw new Error("Missing fixture call");
  const failedRaw = JSON.stringify({
    itemId: first.itemId,
    candidateId: "a",
    status: "timeout",
    output: null,
  });
  const rawPath = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "a/raw/previous.json",
  );
  await writeFile(rawPath, failedRaw);
  const previous = {
    ...first,
    status: "timeout",
    schemaValid: false,
    rawOutputPath: relative(options.repositoryRoot, rawPath),
    rawOutputSha256: sha256Hex(failedRaw),
  };
  await writeFile(
    path,
    [receipts[0], previous, ...receipts.slice(1)]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  await scoreRun(options);
  expect(csvRows(file(written, "summary.csv"))[0]).toMatchObject({
    ok: "3",
    timeout: "0",
    cost_usd: "0.04",
    field_accuracy: "1",
  });
  written.clear();
  await writeFile(rawPath, "tampered previous attempt");
  await expect(scoreRun(options)).rejects.toThrow(rawPath);
  expect(written.size).toBe(0);
});

it("validates every receipt line before writing", async () => {
  const { options, written } = await extractionFixture();
  const path = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "b/receipts.jsonl",
  );
  await writeFile(path, (await readFile(path, "utf8")) + '{"record":"call"}\n');
  await expect(scoreRun(options)).rejects.toThrow("Invalid receipt");
  expect(written.size).toBe(0);
});

it("rejects changed speech split hashes", async () => {
  const { options, written, memory } = await speechFixture();
  memory.set(
    options.speechSplitsPath,
    Buffer.from(
      '{"dataset":"speech-splits-v1","screening":[["clip-1","' +
        "d".repeat(64) +
        '","Arabic"]],"screening_sha256":"' +
        "0".repeat(64) +
        '","sources":[]}',
    ),
  );
  await expect(scoreRun(options)).rejects.toThrow("Speech split hash mismatch");
  expect(written.size).toBe(0);
});

async function changeCandidateReceipts(
  options: ScoreRunOptions,
  changes: Partial<RunHeader>,
  changeCall: (receipt: CallReceipt) => CallReceipt = (receipt) => receipt,
) {
  const path = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "b/receipts.jsonl",
  );
  const receipts = await readReceipts(path);
  await writeFile(
    path,
    receipts
      .map((receipt) =>
        JSON.stringify(
          receipt.record === "run"
            ? { ...receipt, ...changes }
            : changeCall(receipt),
        ),
      )
      .join("\n") + "\n",
  );
}

it.each(["extraction", "speech"] as const)(
  "scores %s candidates collected at different commits and records both",
  async (kind) => {
    const { options, written } =
      kind === "extraction" ? await extractionFixture() : await speechFixture();
    const changed = {
      gitSha: "e".repeat(40),
      registrySha256: "f".repeat(64),
      command: "screen fixture b",
      startedAt: "2026-09-28T01:00:00Z",
    };
    await changeCandidateReceipts(options, changed);
    await scoreRun(options);
    expect(csvRows(file(written, "summary.csv"))).toMatchObject([
      {
        candidate: "a",
        git_sha: "a".repeat(40),
        registry_sha256: "b".repeat(64),
      },
      {
        candidate: "b",
        git_sha: changed.gitSha,
        registry_sha256: changed.registrySha256,
      },
    ]);
    expect(JSON.parse(file(written, "scores.json"))).toMatchObject({
      runFacts: [
        {
          candidateId: "a",
          gitSha: "a".repeat(40),
          registrySha256: "b".repeat(64),
          command: "screen fixture",
          startedAt: "2026-09-28T00:00:00Z",
        },
        { candidateId: "b", ...changed },
      ],
    });
    const facts = file(written, "report.md")
      .split("## Run facts\n\n")[1]
      ?.split("## Candidate summary")[0];
    const rows = facts
      ?.split("\n")
      .filter((line) => /^\| [ab] +\|/u.test(line));
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toContain("a".repeat(40));
    expect(rows?.[0]).toContain("b".repeat(64));
    for (const value of Object.values(changed))
      expect(rows?.[1]).toContain(value);
  },
);

it.each([
  ["splitSha256", "Split hash does not match run header"],
  ["datasetManifestSha256", "Dataset manifest hash does not match run header"],
  ["priceDate", "Candidate run facts differ: priceDate"],
] as const)("refuses a candidate with different %s", async (key, message) => {
  for (const setup of [await extractionFixture(), await speechFixture()]) {
    await changeCandidateReceipts(setup.options, {
      [key]: key === "priceDate" ? "2026-09-27" : "0".repeat(64),
    });
    await expect(scoreRun(setup.options)).rejects.toThrow(message);
    expect(setup.written.size).toBe(0);
  }
});

it.each([
  ["promptSha256", "ok"],
  ["promptSha256", "schema_invalid"],
  ["schemaSha256", "ok"],
  ["schemaSha256", "schema_invalid"],
] as const)(
  "refuses different extraction %s on %s receipts",
  async (key, status) => {
    const { options, written } = await extractionFixture();
    await changeCandidateReceipts(options, {}, (receipt) =>
      receipt.status === status
        ? { ...receipt, [key]: "0".repeat(64) }
        : receipt,
    );
    await expect(scoreRun(options)).rejects.toThrow(
      `Candidate extraction facts differ: ${key} (emirates_id)`,
    );
    expect(written.size).toBe(0);
  },
);

it.each(["promptSha256", "schemaSha256"] as const)(
  "refuses missing extraction %s",
  async (key) => {
    const { options, written } = await extractionFixture();
    await changeCandidateReceipts(options, {}, (receipt) => ({
      ...receipt,
      [key]: null,
    }));
    await expect(scoreRun(options)).rejects.toThrow(
      `Missing extraction ${key}: emirates_id`,
    );
    expect(written.size).toBe(0);
  },
);

it("checks extraction hashes on earlier attempts", async () => {
  const { options, written } = await extractionFixture();
  const path = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "b/receipts.jsonl",
  );
  const receipts = await readReceipts(path);
  const first = receipts[1];
  if (first?.record !== "call") throw new Error("Missing fixture call");
  await writeFile(
    path,
    [
      receipts[0],
      { ...first, promptSha256: "0".repeat(64) },
      ...receipts.slice(1),
    ]
      .map((receipt) => JSON.stringify(receipt))
      .join("\n") + "\n",
  );
  await expect(scoreRun(options)).rejects.toThrow(
    "Candidate extraction facts differ: promptSha256 (emirates_id)",
  );
  expect(written.size).toBe(0);
});

it("counts missing speech items as deletions and not_run", async () => {
  const { options, written } = await speechFixture();
  const path = join(
    options.resultsDir,
    options.runId,
    options.classId,
    "b/receipts.jsonl",
  );
  const receipts = await readReceipts(path);
  await writeFile(
    path,
    receipts
      .slice(0, -1)
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  await scoreRun(options);
  expect(csvRows(file(written, "summary.csv"))[1]).toMatchObject({
    items: "3",
    not_run: "1",
    timeout: "0",
    wer: String(4 / 6),
    cer: String(14 / 24),
  });
});

it("rejects speech raw paths that resolve into the repository", async () => {
  const { options, written } = await speechFixture();
  const resolvePath = vi.fn(async (path: string) =>
    path.startsWith("/virtual/")
      ? join(options.repositoryRoot, "private", path.slice("/virtual/".length))
      : realpath(path),
  );
  await expect(
    scoreRun({ ...options, io: { ...options.io, realpath: resolvePath } }),
  ).rejects.toThrow("outside the repository");
  expect(written.size).toBe(0);
});

it("parses score arguments and help without loading configuration", () => {
  expect(parseScoreArguments(["--", "--help"])).toBeNull();
  expect(
    parseScoreArguments([
      "--run-id",
      "run-1",
      "--class",
      "mc1_document_extraction",
      "--candidates",
      "a,b",
      "--limitations",
      "notes.txt",
    ]),
  ).toEqual({
    "run-id": "run-1",
    class: "mc1_document_extraction",
    candidates: ["a", "b"],
    limitations: "notes.txt",
  });
  for (const args of [
    [],
    ["--unknown"],
    ["--run-id", "../escape", "--class", "mc3_speech_to_text"],
    [
      "--run-id",
      "run-1",
      "--class",
      "mc3_speech_to_text",
      "--candidates",
      "a,a",
    ],
  ])
    expect(() => parseScoreArguments(args)).toThrow(
      "Invalid scoring arguments",
    );
});

it("scores the full held-out document denominator deterministically from header provenance", async () => {
  const { options, labels } = await extractionFixture();
  const original = await loadSplits(options.syntheticDir);
  const screening = [labels[0]?.doc_id];
  const held_out = labels.slice(1).map((label) => label.doc_id);
  const pairHash = (ids: readonly (string | undefined)[]) =>
    sha256Hex(
      JSON.stringify(
        ids.map((id) => [
          id,
          labels.find((label) => label.doc_id === id)?.image_sha256,
        ]),
      ),
    );
  await writeFile(
    join(options.syntheticDir, "splits.json"),
    JSON.stringify({
      ...original,
      screening,
      held_out,
      screening_sha256: pairHash(screening),
      held_out_sha256: pairHash(held_out),
    }),
  );
  for (const candidate of ["a", "b"]) {
    const receipts = await readReceipts(
      join(
        options.resultsDir,
        options.runId,
        options.classId,
        candidate,
        "receipts.jsonl",
      ),
    );
    const run = receipts[0];
    if (run?.record !== "run") throw new Error("Missing fixture header");
    await writeReceipts(
      options,
      { ...run, split: "held_out", splitSha256: pairHash(held_out) },
      receipts.filter(
        (receipt): receipt is CallReceipt =>
          receipt.record === "call" && held_out.includes(receipt.itemId),
      ),
    );
  }
  const files = await scoreRun(options);
  const first = await Promise.all(files.map((file) => readFile(file, "utf8")));
  await scoreRun(options);
  expect(
    await Promise.all(files.map((file) => readFile(file, "utf8"))),
  ).toEqual(first);
  const report = first[files.findIndex((file) => file.endsWith("report.md"))];
  expect(report).toContain("extraction held-out report");
  expect(report).not.toContain("these screening results");
  const summary =
    first[files.findIndex((file) => file.endsWith("summary.csv"))] ?? "";
  expect(summary.split("\n")[1]?.split(",")[3]).toBe("2");
  expect(summary.split("\n")[2]?.split(",")[3]).toBe("2");
});
