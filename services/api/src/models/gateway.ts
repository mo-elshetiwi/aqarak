import { z } from "zod";
import {
  AdapterNotAvailableError,
  ProviderResponseError,
  ProviderUnavailableError,
} from "./errors";
import { getCandidate } from "./registry";
import type { ModelCandidate, ModelRegistry } from "./registry";
import { canonicalJson, sha256Hex } from "./hashing";
import { toStrictJsonSchema } from "./json-schema";
import type { StrictJsonSchema } from "./json-schema";
import { computeCostMicroUsd, ZERO_USAGE } from "./cost";
import type { ModelUsage } from "./cost";
import type { BudgetGuard } from "./budget";
import type {
  CallStatus,
  ModelCallRecord,
  ModelGateway,
  StructuredAdapters,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  TranscriptionAdapters,
  TranscriptionRequest,
  TranscriptionResult,
} from "./contracts";

export interface GatewayOptions {
  readonly registry: ModelRegistry;
  readonly structuredAdapters: StructuredAdapters;
  readonly transcriptionAdapters: TranscriptionAdapters;
  readonly budget?: BudgetGuard;
  readonly onRecord?: (record: ModelCallRecord) => void;
  readonly now: () => Date;
}
interface AttemptState {
  text: string | null;
  usage: ModelUsage;
  modelEcho: string | null;
  parameters: Readonly<Record<string, z.infer<ReturnType<typeof z.json>>>>;
  retries: number;
  transportRetries: number;
  status: CallStatus;
  schemaValid: boolean | null;
  errorCode: string | null;
  errorMessage: string | null;
}
function initialState(candidate: ModelCandidate): AttemptState {
  const parameters = z
    .record(z.string(), z.json())
    .safeParse(candidate.parameters);
  if (!parameters.success) throw new TypeError("Invalid candidate parameters");
  return {
    text: null,
    usage: ZERO_USAGE,
    modelEcho: null,
    parameters: parameters.data,
    retries: 0,
    transportRetries: 0,
    status: "ok",
    schemaValid: null,
    errorCode: null,
    errorMessage: null,
  };
}
function sumUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    audioSeconds: left.audioSeconds + right.audioSeconds,
  };
}
async function timed<T>(options: {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly run: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason: Error) => void) | undefined;
  const abort = (): void => {
    controller.abort();
    rejectAbort?.(
      new ProviderUnavailableError({ cause: new Error("Timeout") }),
    );
  };
  const expired = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    timeout = setTimeout(abort, options.timeoutMs);
  });
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) {
      abort();
      return await expired;
    }
    return await Promise.race([options.run(controller.signal), expired]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
function failure(state: AttemptState, error: unknown): void {
  const known =
    error instanceof ProviderResponseError ||
    error instanceof ProviderUnavailableError;
  const timeout =
    error instanceof ProviderUnavailableError &&
    error.cause instanceof Error &&
    (error.cause.message === "Timeout" ||
      error.cause.name === "TimeoutError" ||
      error.cause.name === "AbortError");
  state.status = timeout ? "timeout" : "provider_error";
  state.errorCode = timeout ? "timeout" : known ? error.name : "ProviderError";
  state.errorMessage = known
    ? `${error.name}${error.status === null ? "" : ` status=${String(error.status)}`}`
    : "ProviderError";
  if (known) state.transportRetries += error.transportRetries;
}
function finish(
  options: GatewayOptions,
  context: {
    readonly request:
      StructuredGenerationRequest<unknown> | TranscriptionRequest;
    readonly candidate: ModelCandidate;
    readonly started: Date;
    readonly jsonSchema: StrictJsonSchema | null;
  },
  state: AttemptState,
): ModelCallRecord {
  const { request, candidate, started, jsonSchema } = context;
  const finished = options.now();
  const structured = "images" in request;
  const costMicroUsd = computeCostMicroUsd(candidate.price, state.usage);
  options.budget?.add(request.classId, costMicroUsd);
  const record: ModelCallRecord = {
    classId: request.classId,
    candidateId: request.candidateId,
    provider: candidate.provider,
    modelId: candidate.modelId,
    modelVersion:
      candidate.version.snapshot ??
      candidate.version.digest ??
      candidate.version.revision,
    modelEcho: state.modelEcho,
    parameters: state.parameters,
    parametersSha256: sha256Hex(canonicalJson(state.parameters)),
    promptId: structured ? request.promptId : null,
    promptVersion: structured ? request.promptVersion : null,
    promptSha256: structured
      ? sha256Hex(canonicalJson([request.instructions, request.userText]))
      : null,
    schemaId: structured ? request.schemaId : null,
    schemaSha256:
      jsonSchema === null ? null : sha256Hex(canonicalJson(jsonSchema.schema)),
    inputSha256: structured
      ? sha256Hex(
          request.images.map((image) => sha256Hex(image.bytes)).join(""),
        )
      : sha256Hex(request.audio.bytes),
    outputSha256: state.text === null ? null : sha256Hex(state.text),
    usage: state.usage,
    latencyMs: Math.max(0, finished.getTime() - started.getTime()),
    costMicroUsd,
    schemaValid: state.schemaValid,
    retries: state.retries,
    transportRetries: state.transportRetries,
    status: state.status,
    errorCode: state.errorCode,
    errorMessage: state.errorMessage,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
  };
  options.onRecord?.(record);
  return Object.freeze(record);
}
function parseOutput<T>(
  text: string | null,
  schema: z.ZodType<T>,
): { readonly valid: true; readonly value: T } | { readonly valid: false } {
  if (text === null) return { valid: false };
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success
      ? { valid: true, value: parsed.data }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}
function timeoutFor(
  request: { readonly timeoutMs?: number },
  candidate: ModelCandidate,
): number {
  return request.timeoutMs ?? (candidate.runtime === "api" ? 120000 : 900000);
}
/** Create a provider-independent gateway with explicit candidate selection and content-free records. */
export function createModelGateway(options: GatewayOptions): ModelGateway {
  return {
    async generateStructured<T>(
      request: StructuredGenerationRequest<T>,
    ): Promise<StructuredGenerationResult<T>> {
      const candidate = getCandidate(
        options.registry,
        request.classId,
        request.candidateId,
      );
      const adapter = options.structuredAdapters[candidate.provider];
      if (!adapter) throw new AdapterNotAvailableError();
      const started = options.now();
      const jsonSchema = toStrictJsonSchema(request.schema, request.schemaId);
      const state = initialState(candidate);
      let output: T | null = null;
      if (options.budget && !options.budget.canSpend(request.classId))
        state.status = "budget_stopped";
      else {
        try {
          await timed({
            ...(request.signal ? { signal: request.signal } : {}),
            timeoutMs: timeoutFor(request, candidate),
            run: async (signal) => {
              for (let attempt = 0; attempt < 2; attempt++) {
                state.retries = attempt;
                const result = await adapter.generate({
                  candidate,
                  instructions: request.instructions,
                  userText: request.userText,
                  images: request.images,
                  jsonSchema,
                  signal,
                });
                if (signal.aborted) return;
                state.text = result.text;
                state.usage = sumUsage(state.usage, result.usage);
                state.modelEcho = result.modelEcho;
                state.transportRetries += result.transportRetries ?? 0;
                if (result.finish !== "completed") {
                  state.status = result.finish;
                  return;
                }
                const parsed = parseOutput(result.text, request.schema);
                state.schemaValid = parsed.valid;
                if (parsed.valid) {
                  output = parsed.value;
                  state.status = "ok";
                  return;
                }
                state.status = "schema_invalid";
              }
            },
          });
        } catch (error) {
          failure(state, error);
        }
      }
      return {
        output,
        rawText: state.text,
        record: finish(
          options,
          { request, candidate, started, jsonSchema },
          state,
        ),
      };
    },
    async transcribe(
      request: TranscriptionRequest,
    ): Promise<TranscriptionResult> {
      const candidate = getCandidate(
        options.registry,
        request.classId,
        request.candidateId,
      );
      const adapter = options.transcriptionAdapters[candidate.provider];
      if (!adapter) throw new AdapterNotAvailableError();
      const started = options.now();
      const state = initialState(candidate);
      let detectedLanguage: string | null = null;
      if (options.budget && !options.budget.canSpend(request.classId))
        state.status = "budget_stopped";
      else {
        try {
          const result = await timed({
            ...(request.signal ? { signal: request.signal } : {}),
            timeoutMs: timeoutFor(request, candidate),
            run: (signal) =>
              adapter.transcribe({ candidate, audio: request.audio, signal }),
          });
          state.text = result.text;
          state.usage = result.usage;
          state.modelEcho = result.modelEcho;
          state.transportRetries = result.transportRetries ?? 0;
          state.parameters = result.effectiveParameters;
          detectedLanguage = result.detectedLanguage;
        } catch (error) {
          failure(state, error);
        }
      }
      return {
        text: state.text,
        detectedLanguage,
        record: finish(
          options,
          { request, candidate, started, jsonSchema: null },
          state,
        ),
      };
    },
  };
}
