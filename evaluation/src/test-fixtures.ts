import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_FIELD_CATALOGUE,
  sha256Hex,
  createModelGateway,
  ZERO_USAGE,
} from "@aqarak/api/models";
import type {
  ModelGateway,
  ModelRegistry,
  BudgetGuard,
} from "@aqarak/api/models";
import type { ScreeningOptions } from "./screening";
export {
  fakeRegistry,
  fakeCandidate,
  fakeRequest,
  fakeWav,
  fakeAudioInput,
  TEST_SCHEMA,
} from "../../services/api/src/models/test-fixtures";

/** Isolate hermetic fixtures inside the workspace's ignored validation directory. */
export async function temporaryDirectory(): Promise<string> {
  const parent = fileURLToPath(new URL("../.validation/", import.meta.url));
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "fixture-"));
}

/** Build three synthetic documents with reproducible image and split hashes. */
export async function writeSyntheticFixture(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const labels = [];
  for (const id of ["doc-1", "doc-2", "doc-3"]) {
    const image = `${id}.jpg`;
    const bytes = Buffer.from(`synthetic image ${id}`);
    await writeFile(join(directory, image), bytes);
    labels.push({
      doc_id: id,
      kind: "emirates_id",
      synthetic: true,
      generator_version: "fixture-1",
      seed: 1,
      layout_family: "fixture",
      image,
      image_sha256: sha256Hex(bytes),
      width: 100,
      height: 80,
      capture: {},
      render_check: {},
      fields: Object.fromEntries(
        DOCUMENT_FIELD_CATALOGUE.emirates_id.map((field) => [
          field.name,
          {
            type: field.type,
            script: "none",
            condition: "absent",
            value: null,
            true_value: null,
            printed: null,
            render_box: null,
            image_box: null,
            decoy: null,
          },
        ]),
      ),
    });
  }
  await writeFile(
    join(directory, "labels.jsonl"),
    labels.map((label) => JSON.stringify(label)).join("\n") + "\n",
  );
  await writeFile(
    join(directory, "splits.json"),
    JSON.stringify({
      dataset: "synthetic-fixture",
      seed: 1,
      rule: "All fixture documents belong to screening.",
      screening: labels.map((label) => label.doc_id),
      held_out: [],
      screening_sha256: sha256Hex(
        JSON.stringify(
          labels.map((label) => [label.doc_id, label.image_sha256]),
        ),
      ),
      held_out_sha256: sha256Hex("[]"),
    }),
  );
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({ version: "fixture-1" }),
  );
}

/** Return a gateway whose deterministic fake adapters never contact a model. */
export function fixtureGateway(
  registry: ModelRegistry,
  budget?: BudgetGuard,
): ModelGateway {
  const structured = {
    async generate() {
      await Promise.resolve();
      return {
        text: JSON.stringify({
          fields: Object.fromEntries(
            DOCUMENT_FIELD_CATALOGUE.emirates_id.map((field) => [
              field.name,
              { value: null, evidence: null, null_reason: "absent" },
            ]),
          ),
        }),
        usage: { ...ZERO_USAGE, inputTokens: 70, outputTokens: 24 },
        modelEcho: "fake-model",
        finish: "completed" as const,
      };
    },
  };
  return createModelGateway({
    registry,
    structuredAdapters: { openai_responses: structured, ollama: structured },
    transcriptionAdapters: {
      openai_transcription: {
        async transcribe(input) {
          await Promise.resolve();
          return {
            text: "synthetic hypothesis",
            detectedLanguage: "ar",
            usage: {
              ...ZERO_USAGE,
              audioSeconds: input.audio.durationMs / 1000,
            },
            modelEcho: null,
            effectiveParameters: {},
          };
        },
      },
    },
    ...(budget ? { budget } : {}),
    now: () => new Date("2026-09-28T00:00:00Z"),
  });
}

/** Supply stable run provenance and contained test paths for screening tests. */
export function fixtureScreeningOptions(
  root: string,
  registry: ModelRegistry,
  gateway: ModelGateway,
): ScreeningOptions {
  return {
    classId: "mc1_document_extraction",
    candidateIds: ["fake-candidate"],
    runId: "fixture-run",
    split: "screening",
    registry,
    gateway,
    repositoryRoot: join(root, "repository"),
    resultsDir: join(root, "repository/results"),
    syntheticDir: join(root, "synthetic"),
    dataDir: join(root, "data"),
    privateRunsDir: join(root, "private"),
    gitSha: "a".repeat(40),
    command: "screen synthetic fixture",
    now: () => new Date("2026-09-28T00:00:00Z"),
    concurrency: 1,
  };
}
