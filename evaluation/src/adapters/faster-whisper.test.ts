import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  candidateSchema,
  modelRegistrySchema,
  createModelGateway,
  sha256Hex,
  DigestMismatchError,
} from "@aqarak/api/models";
import {
  fakeRegistry,
  fakeCandidate,
  fakeAudioInput,
  temporaryDirectory,
} from "../test-fixtures";
import {
  createFasterWhisperAdapter,
  verifyWhisperWeights,
} from "./faster-whisper";
import type { BridgeProcess } from "./faster-whisper";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function weights() {
  const root = await temporaryDirectory();
  roots.push(root);
  const modelDir = join(root, "fake-weights");
  await mkdir(modelDir);
  await writeFile(join(modelDir, "model.bin"), "synthetic weights");
  const fake = fakeCandidate("faster_whisper");
  const parsed = candidateSchema.safeParse({
    ...fake,
    version: { ...fake.version, weightsSha256: sha256Hex("synthetic weights") },
  });
  if (!parsed.success) throw new Error("Invalid fixture");
  return { root, candidate: parsed.data };
}
function fakeBridge(lines: string[]): BridgeProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdin.on("data", (chunk: unknown) => {
    const parsed = z.instanceof(Uint8Array).safeParse(chunk);
    if (!parsed.success) throw new Error("Invalid chunk");
    const line = Buffer.from(parsed.data).toString("utf8");
    lines.push(line);
    const request = z
      .object({ id: z.string(), path: z.string(), language: z.null() })
      .safeParse(JSON.parse(line));
    if (!request.success) throw new Error("Invalid protocol request");
    stdout.write(
      `${JSON.stringify({ id: request.data.id, text: "synthetic transcript", language: "ar", language_probability: 0.9, duration_s: 5, error: null })}\n`,
    );
  });
  return Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => {
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
      return true;
    }),
  });
}
it("AC-8 exchanges three lines through one process and records hashes and duration without text", async () => {
  const { root, candidate } = await weights();
  const lines: string[] = [];
  const child = fakeBridge(lines);
  const spawn = vi.fn(() => child);
  const adapter = createFasterWhisperAdapter({
    python: "/fake/python",
    modelsDir: root,
    candidate,
    spawn,
  });
  const registry = fakeRegistry("faster_whisper");
  const entry = registry.classes.mc3_speech_to_text;
  const parsed = modelRegistrySchema.safeParse({
    ...registry,
    classes: {
      ...registry.classes,
      mc3_speech_to_text: {
        ...entry,
        candidates: { "fake-candidate": candidate },
      },
    },
  });
  if (!parsed.success) throw new Error("Invalid fixture registry");
  const gateway = createModelGateway({
    registry: parsed.data,
    structuredAdapters: {},
    transcriptionAdapters: { faster_whisper: adapter },
    now: () => new Date(),
  });
  try {
    for (let index = 0; index < 3; index++) {
      const result = await gateway.transcribe({
        classId: "mc3_speech_to_text",
        candidateId: "fake-candidate",
        audio: {
          ...fakeAudioInput().audio,
          path: `/synthetic-${String(index)}.wav`,
        },
      });
      expect(result.record).toMatchObject({
        status: "ok",
        outputSha256: sha256Hex("synthetic transcript"),
        usage: { audioSeconds: 5 },
      });
      expect(JSON.stringify(result.record)).not.toContain(
        "synthetic transcript",
      );
    }
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(3);
    expect(spawn.mock.calls[0]).toBeDefined();
  } finally {
    adapter.close();
  }
  expect(child.kill).toHaveBeenCalledTimes(1);
});
it("AC-8 refuses mismatched or absent weights before spawning", async () => {
  const { root, candidate } = await weights();
  const spawn = vi.fn(() => fakeBridge([]));
  await writeFile(join(root, "fake-weights/model.bin"), "different weights");
  const adapter = createFasterWhisperAdapter({
    python: "/fake/python",
    modelsDir: root,
    candidate,
    spawn,
  });
  await expect(
    adapter.transcribe({
      ...fakeAudioInput("faster_whisper"),
      candidate,
      audio: { ...fakeAudioInput().audio, path: "/fake.wav" },
    }),
  ).rejects.toThrow(DigestMismatchError);
  expect(spawn).not.toHaveBeenCalled();
  await expect(
    verifyWhisperWeights({
      modelDir: join(root, "absent"),
      expectedSha256: "0".repeat(64),
    }),
  ).rejects.toThrow(DigestMismatchError);
  adapter.close();
});
