import { mkdir, readFile, writeFile, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256Hex } from "@aqarak/api/models";
import {
  temporaryDirectory,
  fakeRegistry,
  fixtureGateway,
  fixtureScreeningOptions,
  fakeWav,
} from "./test-fixtures";
import { loadSyntheticDocs, loadSplits } from "./datasets/synthetic-docs";
import { loadMixat } from "./datasets/mixat";
import { runScreening } from "./screening";
import { readReceipts } from "./receipts";
import { scoreRun } from "./score-run";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("collects and scores MIXAT and FLEURS held-out receipts without exposing speech text", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  const registry = fakeRegistry("openai_transcription");
  const gateway = fixtureGateway(registry);
  const transcribe = vi.spyOn(gateway, "transcribe");
  const options = {
    ...fixtureScreeningOptions(root, registry, gateway),
    classId: "mc3_speech_to_text" as const,
    split: "held_out" as const,
    speechSplitsPath: join(root, "speech-splits.json"),
  };
  await mkdir(options.repositoryRoot);
  const audio = fakeWav();
  const audioHash = sha256Hex(audio);
  const sources = [];
  for (const source of ["mixat", "fleurs"]) {
    const directory = join(options.dataDir, source);
    const labels =
      source === "mixat"
        ? ["screened", "held"].map((id) => ({
            id,
            part: 1,
            file: `${id}.wav`,
            split: "test",
            language: "Arabic",
            duration_ms: 200,
            transcript: "synthetic hypothesis",
          }))
        : [
            {
              id: "en_us/123",
              lang: "en_us",
              file: "en_us/123.wav",
              num_samples: 3200,
              transcription: "synthetic hypothesis",
            },
          ];
    const files = [];
    for (const label of labels) {
      const path = join(directory, label.file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, audio);
      files.push({ path: label.file, sha256: audioHash });
    }
    const text = labels.map((label) => JSON.stringify(label)).join("\n") + "\n";
    await writeFile(join(directory, "labels.jsonl"), text);
    files.push({ path: "labels.jsonl", sha256: sha256Hex(text) });
    const manifest = JSON.stringify({ files });
    await writeFile(join(directory, "manifest.json"), manifest);
    sources.push({ name: source, manifest_sha256: sha256Hex(manifest) });
  }
  const split = {
    dataset: "speech-splits-v1",
    sources,
    screening: [["screened", audioHash, "Arabic"]],
    held_out: [
      ["held", audioHash, "Arabic"],
      ["en_us/123", audioHash, "en_us"],
    ],
    screening_sha256: sha256Hex(JSON.stringify([["screened", audioHash]])),
    held_out_sha256: sha256Hex(
      JSON.stringify([
        ["held", audioHash],
        ["en_us/123", audioHash],
      ]),
    ),
  };
  await writeFile(options.speechSplitsPath, JSON.stringify(split));
  await runScreening({
    ...options,
    prepareAudio: async ({ sourcePath }) => {
      await Promise.resolve();
      return {
        path: sourcePath,
        bytes: audio,
        sha256: audioHash,
        durationMs: 200,
      };
    },
  });
  expect(transcribe).toHaveBeenCalledTimes(2);
  const receipts = await readReceipts(
    join(
      options.resultsDir,
      options.runId,
      options.classId,
      "fake-candidate/receipts.jsonl",
    ),
  );
  expect(receipts[0]).toMatchObject({
    split: "held_out",
    splitSha256: split.held_out_sha256,
    datasetManifestSha256: sha256Hex(JSON.stringify(split)),
  });
  expect(receipts[2]).toMatchObject({ itemId: "en_us/123", status: "ok" });
  const scoring = {
    ...options,
    candidateIds: ["fake-candidate"],
    io: {
      readBytes: readFile,
      writeText: (path: string, text: string) => writeFile(path, text),
      realpath,
      readReceipts,
      loadSyntheticDocs,
      loadSplits,
      loadMixat,
      listCandidates: () => Promise.resolve(["fake-candidate"]),
    },
  };
  const paths = await scoreRun(scoring);
  const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  await scoreRun(scoring);
  expect(
    await Promise.all(paths.map((path) => readFile(path, "utf8"))),
  ).toEqual(before);
  expect(before.join("\n")).not.toContain("synthetic hypothesis");
  expect(before.join("\n")).toContain("speech held-out report");
  expect(before.join("\n")).toContain("en_us/123");
  await writeFile(
    options.speechSplitsPath,
    JSON.stringify({ ...split, held_out_sha256: "0".repeat(64) }),
  );
  await expect(runScreening({ ...options, runId: "tampered" })).rejects.toThrow(
    "Speech split hash mismatch",
  );
  expect(transcribe).toHaveBeenCalledTimes(2);
});
