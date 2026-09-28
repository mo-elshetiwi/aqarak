import { z } from "zod";
import {
  modelRegistrySchema,
  modelClassIdSchema,
  getCandidate,
} from "./registry";
import type { ModelRegistry, ModelCandidate, ModelProvider } from "./registry";
import type {
  StructuredGenerationRequest,
  TranscriptionAdapterInput,
} from "./contracts";
export const TEST_SCHEMA = z.strictObject({ value: z.string() });
/** Build a complete fake registry without copying committed identifiers. */
export function fakeRegistry(
  provider: ModelProvider = "openai_responses",
): ModelRegistry {
  const parameters = {
    openai_responses: {
      reasoningEffort: "low",
      imageDetail: "high",
      maxOutputTokens: 50,
    },
    openai_transcription: { responseFormat: "json" },
    amazon_transcribe_streaming: {
      region: "us-east-1",
      identifyLanguage: true,
      languageOptions: ["ar-AE", "en-US"],
      preferredLanguage: "ar-AE",
      mediaEncoding: "pcm",
      sampleRateHertz: 16000,
      realtimeFactor: 1,
    },
    ollama: {
      temperature: 0,
      seed: 20260928,
      numCtx: 8192,
      numPredict: 3072,
      think: false,
    },
    faster_whisper: {
      weightsDirName: "fake-weights",
      computeType: "int8",
      beamSize: 5,
      temperature: 0,
      conditionOnPreviousText: false,
      language: null,
    },
    openai_embeddings: {},
    sentence_transformers: {},
  };
  const parsed = modelRegistrySchema.safeParse({
    registryVersion: 1,
    updatedOn: "2026-09-28",
    classes: Object.fromEntries(
      modelClassIdSchema.options.map((id) => [
        id,
        {
          purpose: "Test a synthetic call.",
          status: "pre_registered",
          decisionRecord: null,
          primary: "fake-candidate",
          fallback: null,
          degraded: "manual_form",
          candidates: {
            "fake-candidate": {
              provider,
              modelId: "fake-model",
              runtime:
                provider === "ollama" || provider === "faster_whisper"
                  ? "local"
                  : "api",
              licence: "test",
              version: {
                snapshot: null,
                digest: "sha256:fake",
                revision: "fake-revision",
                weightsSha256: "0".repeat(64),
              },
              parameters: parameters[provider],
              price: {
                unit: "token",
                inputUsdPerMillion: 0.1,
                outputUsdPerMillion: 0.5,
                source: "fixture",
                priceDate: "2026-09-28",
              },
            },
          },
        },
      ]),
    ),
  });
  if (!parsed.success)
    throw new Error("Invalid test registry", { cause: parsed.error });
  return parsed.data;
}
/** Resolve the fake candidate used by hermetic adapter tests. */
export function fakeCandidate(
  provider: ModelProvider = "openai_responses",
): ModelCandidate {
  return getCandidate(
    fakeRegistry(provider),
    "mc1_document_extraction",
    "fake-candidate",
  );
}
/** Build a synthetic structured request with a tiny schema. */
export function fakeRequest(): StructuredGenerationRequest<
  z.infer<typeof TEST_SCHEMA>
> {
  return {
    classId: "mc1_document_extraction",
    candidateId: "fake-candidate",
    promptId: "test",
    promptVersion: 1,
    instructions: "Return a synthetic value.",
    userText: "Test only.",
    images: [{ mediaType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }],
    schemaId: "test",
    schema: TEST_SCHEMA,
  };
}
/** Create a valid in-memory mono PCM WAV for streaming tests. */
export function fakeWav(size = 6400): Uint8Array {
  const bytes = Buffer.alloc(44 + size);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + size, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(size, 40);
  return bytes;
}
/** Create a synthetic transcription adapter input. */
export function fakeAudioInput(
  provider: ModelProvider = "openai_transcription",
): TranscriptionAdapterInput {
  return {
    candidate: fakeCandidate(provider),
    audio: {
      mediaType: "audio/wav",
      fileName: "fake.wav",
      bytes: fakeWav(),
      path: null,
      durationMs: 5000,
    },
    signal: new AbortController().signal,
  };
}
