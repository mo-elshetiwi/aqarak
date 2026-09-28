import { expect, it, vi } from "vitest";
import { fakeAudioInput, fakeCandidate } from "../../models/test-fixtures";
import { modelRegistrySchema } from "../../models";
import {
  audioFormat,
  createProductionIntakeModels,
  transcribeVoice,
  triageReport,
  type Receipt,
} from "./intake-models";
import { fakeIntakeModels } from "./model-fixtures";

it.each([
  [["ok"], 1, true],
  [["fail", "ok"], 2, true],
  [["fail", "fail"], 2, false],
  [["empty", "ok"], 2, true],
] as const)(
  "AC-1 speech candidate order %j",
  async (speech, count, success) => {
    const receipts: Receipt[] = [];
    const models = fakeIntakeModels({ speech });
    const result = await transcribeVoice(
      models,
      fakeAudioInput().audio,
      "synthetic-media",
      receipts,
    );
    expect(result !== null).toBe(success);
    expect(receipts).toHaveLength(count);
    expect(receipts.map((r) => r.record.candidateId)).toEqual(
      count === 1 ? ["primary"] : ["primary", "fallback"],
    );
  },
);
it.each([
  [["ok"], 1, true],
  [["fail", "ok"], 2, true],
  [["fail", "fail"], 2, false],
  [["invalid", "invalid", "ok"], 2, true],
] as const)(
  "AC-1 triage candidate order and strict schema %j",
  async (triage, count, success) => {
    const receipts: Receipt[] = [];
    const result = await triageReport(
      fakeIntakeModels({ triage }),
      { text: "synthetic", language: "ar", images: [] },
      receipts,
    );
    expect(result !== null).toBe(success);
    expect(receipts).toHaveLength(count);
    if (triage[0] === "invalid")
      expect(receipts[0]?.record.status).toBe("schema_invalid");
  },
);
it("AC-2 skips streaming for MP4 and degrades AAC without calling a gateway", async () => {
  const models = fakeIntakeModels();
  const entry = models.registry.classes.mc3_speech_to_text;
  models.registry = modelRegistrySchema.parse({
    ...models.registry,
    classes: {
      ...models.registry.classes,
      mc3_speech_to_text: {
        ...entry,
        candidates: {
          ...entry.candidates,
          primary: fakeCandidate("amazon_transcribe_streaming"),
        },
      },
    },
  });
  models.providers = [...models.providers, "amazon_transcribe_streaming"];
  const transcribe = vi.spyOn(models.gateway, "transcribe");
  const receipts: Receipt[] = [];
  await transcribeVoice(
    models,
    { ...fakeAudioInput().audio, ...audioFormat("audio/mp4") },
    "synthetic",
    receipts,
  );
  expect(transcribe).toHaveBeenCalledOnce();
  expect(transcribe.mock.calls[0]?.[0].candidateId).toBe("fallback");
  expect(audioFormat("audio/aac")).toBeNull();
  await transcribeVoice(models, null, "synthetic", receipts);
  expect(transcribe).toHaveBeenCalledOnce();
});
it("AC-3 production factory without a key configures no adapters and degrades without network", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const network = vi.spyOn(globalThis, "fetch");
  try {
    const models = createProductionIntakeModels();
    expect(models.providers).toEqual([]);
    const receipts: Receipt[] = [];
    expect(
      await transcribeVoice(
        models,
        fakeAudioInput().audio,
        "synthetic",
        receipts,
      ),
    ).toBeNull();
    expect(
      await triageReport(
        models,
        { text: "synthetic", language: "en", images: [] },
        receipts,
      ),
    ).toBeNull();
    expect(receipts).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    network.mockRestore();
  }
});
it.each([
  ["audio/mp4", "audio/mp4", "voice-note.m4a"],
  ["audio/m4a", "audio/mp4", "voice-note.m4a"],
  ["audio/mpeg", "audio/mpeg", "voice-note.mp3"],
  ["audio/webm", "audio/webm", "voice-note.webm"],
  ["audio/wav", "audio/wav", "voice-note.wav"],
])(
  "maps %s to accepted speech container",
  (contentType, mediaType, fileName) => {
    expect(audioFormat(contentType)).toEqual({ mediaType, fileName });
  },
);
it("times out each gateway attempt after twelve seconds and records failures", async () => {
  vi.useFakeTimers();
  try {
    const models = fakeIntakeModels();
    models.gateway = {
      ...models.gateway,
      transcribe: () => new Promise(() => undefined),
    };
    const receipts: Receipt[] = [];
    const result = transcribeVoice(
      models,
      fakeAudioInput().audio,
      "synthetic",
      receipts,
    );
    await vi.advanceTimersByTimeAsync(24000);
    expect(await result).toBeNull();
    expect(receipts.map((r) => r.record.status)).toEqual([
      "timeout",
      "timeout",
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("reserves request time for persistence by bounding model attempts to twenty seconds", async () => {
  vi.useFakeTimers();
  try {
    const models = fakeIntakeModels();
    models.deadline = Date.now() + 20000;
    models.gateway = {
      ...models.gateway,
      generateStructured: () => new Promise(() => undefined),
    };
    const receipts: Receipt[] = [];
    const result = triageReport(
      models,
      { text: "synthetic", language: "en", images: [] },
      receipts,
    );
    await vi.advanceTimersByTimeAsync(20000);
    expect(await result).toBeNull();
    expect(receipts.map((receipt) => receipt.record.latencyMs)).toEqual([
      12000, 8000,
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("skips local candidates and providers without a configured adapter", async () => {
  const models = fakeIntakeModels();
  const entry = models.registry.classes.mc3_speech_to_text;
  models.registry = modelRegistrySchema.parse({
    ...models.registry,
    classes: {
      ...models.registry.classes,
      mc3_speech_to_text: {
        ...entry,
        candidates: {
          ...entry.candidates,
          primary: { ...entry.candidates.primary, runtime: "local" },
        },
      },
    },
  });
  const call = vi.spyOn(models.gateway, "transcribe");
  const receipts: Receipt[] = [];
  await transcribeVoice(models, fakeAudioInput().audio, "synthetic", receipts);
  expect(call).toHaveBeenCalledOnce();
  expect(call.mock.calls[0]?.[0].candidateId).toBe("fallback");
  models.providers = [];
  expect(
    await transcribeVoice(
      models,
      fakeAudioInput().audio,
      "synthetic",
      receipts,
    ),
  ).toBeNull();
  expect(call).toHaveBeenCalledOnce();
});
