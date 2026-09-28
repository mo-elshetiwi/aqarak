import { z } from "zod";
import { modelClassIdSchema, providerSchema } from "./registry";
import type { ModelCandidate, ModelClassId, ModelProvider } from "./registry";
import type { ModelUsage } from "./cost";
import type { StrictJsonSchema } from "./json-schema";

export const usageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    audioSeconds: z.number().nonnegative(),
  })
  .readonly();
export const callStatusSchema = z.enum([
  "ok",
  "schema_invalid",
  "refused",
  "incomplete",
  "provider_error",
  "timeout",
  "budget_stopped",
]);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const modelCallRecordSchema = z
  .strictObject({
    classId: modelClassIdSchema,
    candidateId: z.string(),
    provider: providerSchema,
    modelId: z.string(),
    modelVersion: z.string().nullable(),
    modelEcho: z.string().nullable(),
    parameters: z.record(z.string(), z.json()).readonly(),
    parametersSha256: hashSchema,
    promptId: z.string().nullable(),
    promptVersion: z.number().int().nullable(),
    promptSha256: hashSchema.nullable(),
    schemaId: z.string().nullable(),
    schemaSha256: hashSchema.nullable(),
    inputSha256: hashSchema,
    outputSha256: hashSchema.nullable(),
    usage: usageSchema,
    latencyMs: z.number().nonnegative(),
    costMicroUsd: z.number().int().nonnegative(),
    schemaValid: z.boolean().nullable(),
    retries: z.number().int().nonnegative(),
    transportRetries: z.number().int().nonnegative(),
    status: callStatusSchema,
    errorCode: z.string().nullable(),
    errorMessage: z.string().max(300).nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
  })
  .readonly();
export type ModelCallRecord = z.infer<typeof modelCallRecordSchema>;
export type CallStatus = z.infer<typeof callStatusSchema>;
export interface ModelImage {
  readonly mediaType: "image/jpeg" | "image/png";
  readonly bytes: Uint8Array;
}
export interface ModelAudio {
  readonly mediaType: "audio/wav" | "audio/mp4" | "audio/mpeg" | "audio/webm";
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly path: string | null;
  readonly durationMs: number;
}
export interface StructuredGenerationRequest<T> {
  readonly classId: ModelClassId;
  readonly candidateId: string;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly instructions: string;
  readonly userText: string;
  readonly images: readonly ModelImage[];
  readonly schemaId: string;
  readonly schema: z.ZodType<T>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface TranscriptionRequest {
  readonly classId: ModelClassId;
  readonly candidateId: string;
  readonly audio: ModelAudio;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface StructuredAdapterInput {
  readonly candidate: ModelCandidate;
  readonly instructions: string;
  readonly userText: string;
  readonly images: readonly ModelImage[];
  readonly jsonSchema: StrictJsonSchema;
  readonly signal: AbortSignal;
}
export interface TranscriptionAdapterInput {
  readonly candidate: ModelCandidate;
  readonly audio: ModelAudio;
  readonly signal: AbortSignal;
}
export interface StructuredAdapterResult {
  readonly text: string | null;
  readonly usage: ModelUsage;
  readonly modelEcho: string | null;
  readonly finish: "completed" | "incomplete" | "refused";
  readonly transportRetries?: number;
}
export interface TranscriptionAdapterResult {
  readonly text: string;
  readonly detectedLanguage: string | null;
  readonly usage: ModelUsage;
  readonly modelEcho: string | null;
  readonly effectiveParameters: Readonly<
    Record<string, z.infer<ReturnType<typeof z.json>>>
  >;
  readonly transportRetries?: number;
}
export interface StructuredAdapter {
  readonly generate: (
    input: StructuredAdapterInput,
  ) => Promise<StructuredAdapterResult>;
}
export interface TranscriptionAdapter {
  readonly transcribe: (
    input: TranscriptionAdapterInput,
  ) => Promise<TranscriptionAdapterResult>;
}
export interface StructuredGenerationResult<T> {
  readonly output: T | null;
  readonly rawText: string | null;
  readonly record: ModelCallRecord;
}
export interface TranscriptionResult {
  readonly text: string | null;
  readonly detectedLanguage: string | null;
  readonly record: ModelCallRecord;
}
export interface ModelGateway {
  readonly generateStructured: <T>(
    request: StructuredGenerationRequest<T>,
  ) => Promise<StructuredGenerationResult<T>>;
  readonly transcribe: (
    request: TranscriptionRequest,
  ) => Promise<TranscriptionResult>;
}
export type StructuredAdapters = Readonly<
  Partial<Record<ModelProvider, StructuredAdapter>>
>;
export type TranscriptionAdapters = Readonly<
  Partial<Record<ModelProvider, TranscriptionAdapter>>
>;
