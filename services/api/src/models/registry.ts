import registryData from "./model-registry.json" with { type: "json" };
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./hashing";
import { UnknownCandidateError } from "./errors";

export const modelClassIdSchema = z.enum([
  "mc1_document_extraction",
  "mc2_contract_understanding",
  "mc3_speech_to_text",
  "mc4_photo_triage",
  "mc5_drafting",
  "mc6_embeddings",
  "mc7_orchestration",
]);
export const providerSchema = z.enum([
  "openai_responses",
  "openai_transcription",
  "amazon_transcribe_streaming",
  "ollama",
  "faster_whisper",
  "openai_embeddings",
  "sentence_transformers",
]);
const priceMetadata = { source: z.string().min(1), priceDate: z.iso.date() };
export const priceSchema = z.discriminatedUnion("unit", [
  z.strictObject({
    unit: z.literal("token"),
    inputUsdPerMillion: z.number().nonnegative(),
    outputUsdPerMillion: z.number().nonnegative(),
    ...priceMetadata,
  }),
  z.strictObject({
    unit: z.literal("audio_minute"),
    usdPerMinute: z.number().nonnegative(),
    ...priceMetadata,
  }),
  z.strictObject({
    unit: z.literal("audio_second"),
    usdPerSecond: z.number().nonnegative(),
    ...priceMetadata,
  }),
  z.strictObject({ unit: z.literal("none"), ...priceMetadata }),
]);
export const responseParametersSchema = z.strictObject({
  reasoningEffort: z.enum(["low", "medium", "high"]),
  imageDetail: z.enum(["low", "high", "auto"]).optional(),
  maxOutputTokens: z.number().int().positive(),
});
export const ollamaParametersSchema = z.strictObject({
  temperature: z.number().nonnegative(),
  seed: z.number().int(),
  numCtx: z.number().int().positive(),
  numPredict: z.number().int().positive(),
  think: z.boolean(),
});
export const whisperParametersSchema = z.strictObject({
  weightsDirName: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  computeType: z.literal("int8"),
  beamSize: z.number().int().positive(),
  temperature: z.literal(0),
  conditionOnPreviousText: z.literal(false),
  language: z.null(),
});
export const transcribeParametersSchema = z.strictObject({
  region: z.string(),
  identifyLanguage: z.literal(true),
  languageOptions: z.tuple([z.literal("ar-AE"), z.literal("en-US")]),
  preferredLanguage: z.literal("ar-AE"),
  mediaEncoding: z.literal("pcm"),
  sampleRateHertz: z.literal(16000),
  realtimeFactor: z.number().positive().max(1),
});
export const transcriptionParametersSchema = z.strictObject({
  responseFormat: z.literal("json"),
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).optional(),
});
const candidateBase = {
  modelId: z.string().min(1),
  runtime: z.enum(["api", "local"]),
  licence: z.string().min(1),
  version: z
    .strictObject({
      snapshot: z.string().nullable(),
      digest: z.string().nullable(),
      revision: z.string().nullable(),
      weightsSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
    })
    .readonly(),
  price: priceSchema.readonly(),
};
export const candidateSchema = z
  .discriminatedUnion("provider", [
    z.strictObject({
      ...candidateBase,
      provider: z.literal("openai_responses"),
      parameters: responseParametersSchema.readonly(),
    }),
    z.strictObject({
      ...candidateBase,
      provider: z.literal("openai_transcription"),
      parameters: transcriptionParametersSchema.readonly(),
    }),
    z.strictObject({
      ...candidateBase,
      provider: z.literal("amazon_transcribe_streaming"),
      parameters: transcribeParametersSchema.readonly(),
    }),
    z.strictObject({
      ...candidateBase,
      provider: z.literal("ollama"),
      parameters: ollamaParametersSchema.readonly(),
    }),
    z.strictObject({
      ...candidateBase,
      provider: z.literal("faster_whisper"),
      parameters: whisperParametersSchema.readonly(),
    }),
    z.strictObject({
      ...candidateBase,
      provider: z.literal("openai_embeddings"),
      parameters: z.strictObject({}).readonly(),
    }),
    z.strictObject({
      ...candidateBase,
      provider: z.literal("sentence_transformers"),
      parameters: z.strictObject({}).readonly(),
    }),
  ])
  .readonly();
const modelClassSchema = z
  .strictObject({
    purpose: z.string().min(1),
    status: z.enum(["pre_registered", "decided"]),
    decisionRecord: z.string().nullable(),
    primary: z.string(),
    fallback: z.string().nullable(),
    degraded: z.enum([
      "manual_form",
      "manual_entry",
      "typing",
      "untriaged",
      "template_only",
      "lexical_only",
      "forms_only",
    ]),
    candidates: z.record(z.string(), candidateSchema).readonly(),
  })
  .superRefine((value, context) => {
    for (const id of [value.primary, value.fallback]) {
      if (id !== null && !Object.hasOwn(value.candidates, id))
        context.addIssue({
          code: "custom",
          message: "Candidate reference is absent",
        });
    }
  })
  .readonly();
export const modelRegistrySchema = z
  .strictObject({
    registryVersion: z.literal(1),
    updatedOn: z.iso.date(),
    classes: z.record(modelClassIdSchema, modelClassSchema).readonly(),
  })
  .readonly();
export type ModelClassId = z.infer<typeof modelClassIdSchema>;
export type ModelRegistry = z.infer<typeof modelRegistrySchema>;
export type ModelCandidate = z.infer<typeof candidateSchema>;
export type ModelPrice = z.infer<typeof priceSchema>;
export type ModelProvider = z.infer<typeof providerSchema>;

/** Load and validate the committed candidate registry. */
export function loadModelRegistry(): ModelRegistry {
  const parsed = modelRegistrySchema.safeParse(registryData);
  if (!parsed.success)
    throw new TypeError("Invalid model registry", { cause: parsed.error });
  return parsed.data;
}
/** Resolve an explicitly selected candidate without silently substituting another. */
export function getCandidate(
  registry: ModelRegistry,
  classId: ModelClassId,
  candidateId: string,
): ModelCandidate {
  const candidate = registry.classes[classId].candidates[candidateId];
  if (
    !candidate ||
    !Object.hasOwn(registry.classes[classId].candidates, candidateId)
  )
    throw new UnknownCandidateError();
  return candidate;
}
/** Fingerprint the canonical registry configuration. */
export function registrySha256(registry: ModelRegistry): string {
  return sha256Hex(canonicalJson(registry));
}
