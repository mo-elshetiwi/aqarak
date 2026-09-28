import { setTimeout } from "node:timers/promises";
import {
  createModelGateway,
  createOpenAiResponsesAdapter,
  createOpenAiTranscriptionAdapter,
  createAmazonTranscribeStreamingAdapter,
  TranscribeStreamingClient,
  getCandidate,
  AdapterNotAvailableError,
} from "@aqarak/api/models";
import type {
  ModelRegistry,
  ModelCandidate,
  ModelGateway,
  BudgetGuard,
} from "@aqarak/api/models";
import type { EvaluationConfig } from "./config";
import type { ScreeningClass } from "./screening";
import { createOllamaAdapter, verifyOllamaDigest } from "./adapters/ollama";
import { createFasterWhisperAdapter } from "./adapters/faster-whisper";
import type { WhisperAdapter } from "./adapters/faster-whisper";

export interface ScreeningRuntime {
  readonly gateway: ModelGateway;
  readonly beforeCandidate: (candidate: ModelCandidate) => Promise<void>;
  readonly close: () => void;
}

/** Wire only selected candidates, retaining explicit ownership of local and streaming resources. */
export function createScreeningRuntime(options: {
  readonly config: EvaluationConfig;
  readonly registry: ModelRegistry;
  readonly classId: ScreeningClass;
  readonly candidateIds: readonly string[];
  readonly budget: BudgetGuard;
  readonly now: () => Date;
}): ScreeningRuntime {
  const candidates = options.candidateIds.map((id) =>
    getCandidate(options.registry, options.classId, id),
  );
  const usesOpenAi = candidates.some(
    (candidate) =>
      candidate.provider === "openai_responses" ||
      candidate.provider === "openai_transcription",
  );
  if (usesOpenAi && !options.config.OPENAI_API_KEY)
    throw new Error("Missing provider configuration");
  const openAi = {
    apiKey: options.config.OPENAI_API_KEY ?? "",
    baseUrl: options.config.OPENAI_BASE_URL,
    fetch: globalThis.fetch,
  };
  const ollama = { host: options.config.OLLAMA_HOST, fetch: globalThis.fetch };
  const whisper = new Map<ModelCandidate, WhisperAdapter>();
  const streaming = candidates.find(
    (candidate) => candidate.provider === "amazon_transcribe_streaming",
  );
  const client =
    streaming?.provider === "amazon_transcribe_streaming"
      ? new TranscribeStreamingClient({
          region: streaming.parameters.region,
          maxAttempts: 3,
        })
      : null;
  for (const candidate of candidates) {
    if (candidate.provider === "faster_whisper")
      whisper.set(
        candidate,
        createFasterWhisperAdapter({
          python: options.config.AQARAK_EVAL_PYTHON,
          modelsDir: options.config.AQARAK_WHISPER_MODELS_DIR,
          candidate,
        }),
      );
  }
  const gateway = createModelGateway({
    registry: options.registry,
    budget: options.budget,
    now: options.now,
    structuredAdapters: {
      openai_responses: createOpenAiResponsesAdapter(openAi),
      ollama: createOllamaAdapter(ollama),
    },
    transcriptionAdapters: {
      openai_transcription: createOpenAiTranscriptionAdapter(openAi),
      ...(client
        ? {
            amazon_transcribe_streaming: createAmazonTranscribeStreamingAdapter(
              {
                client,
                sleep: async (ms): Promise<void> => {
                  await setTimeout(ms);
                },
              },
            ),
          }
        : {}),
      faster_whisper: {
        transcribe(input) {
          const adapter = whisper.get(input.candidate);
          if (!adapter) throw new AdapterNotAvailableError();
          return adapter.transcribe(input);
        },
      },
    },
  });
  return {
    gateway,
    async beforeCandidate(candidate): Promise<void> {
      if (candidate.provider === "ollama") {
        if (candidate.version.digest === null)
          throw new Error("Missing local digest");
        await verifyOllamaDigest({
          ...ollama,
          modelId: candidate.modelId,
          expectedDigest: candidate.version.digest,
        });
      }
      await whisper.get(candidate)?.verify();
    },
    close(): void {
      for (const adapter of whisper.values()) adapter.close();
      client?.destroy();
    },
  };
}
