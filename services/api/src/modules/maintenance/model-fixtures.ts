import {
  createModelGateway,
  ZERO_USAGE,
  modelRegistrySchema,
  type ModelRegistry,
} from "../../models";
import { fakeRegistry, fakeCandidate } from "../../models/test-fixtures";
import type { IntakeModels } from "./intake-models";

export const syntheticTriage = {
  category: "plumbing",
  priority: "routine",
  safetyFlags: ["water_into_electrics"],
  summary: "يوجد تسرب مياه بالقرب من الكهرباء.",
  payer: "owner",
  confidence: 0.91,
};
export function intakeRegistry(): ModelRegistry {
  const base = fakeRegistry();
  return modelRegistrySchema.parse({
    ...base,
    classes: {
      ...base.classes,
      mc3_speech_to_text: {
        ...base.classes.mc3_speech_to_text,
        primary: "primary",
        fallback: "fallback",
        degraded: "typing",
        candidates: {
          primary: fakeCandidate("openai_transcription"),
          fallback: fakeCandidate("openai_transcription"),
        },
      },
      mc4_photo_triage: {
        ...base.classes.mc4_photo_triage,
        primary: "primary",
        fallback: "fallback",
        degraded: "untriaged",
        candidates: { primary: fakeCandidate(), fallback: fakeCandidate() },
      },
    },
  });
}
export function fakeIntakeModels(
  options: {
    speech?: readonly ("ok" | "fail" | "empty")[];
    triage?: readonly ("ok" | "fail" | "invalid")[];
  } = {},
): IntakeModels {
  const registry = intakeRegistry();
  let speech = 0;
  let triage = 0;
  return {
    registry,
    providers: ["openai_responses", "openai_transcription"],
    gateway: createModelGateway({
      registry,
      now: () => new Date(),
      transcriptionAdapters: {
        openai_transcription: {
          transcribe: () => {
            const outcome = options.speech?.[speech++] ?? "ok";
            if (outcome === "fail")
              return Promise.reject(new Error("Synthetic provider failure"));
            return Promise.resolve({
              text: outcome === "empty" ? "" : "يوجد تسرب مياه في المطبخ",
              detectedLanguage: "ar",
              usage: ZERO_USAGE,
              modelEcho: null,
              effectiveParameters: {},
            });
          },
        },
      },
      structuredAdapters: {
        openai_responses: {
          generate: () => {
            const outcome = options.triage?.[triage++] ?? "ok";
            if (outcome === "fail")
              return Promise.reject(new Error("Synthetic provider failure"));
            return Promise.resolve({
              text: JSON.stringify(
                outcome === "invalid"
                  ? { category: "invalid" }
                  : syntheticTriage,
              ),
              usage: ZERO_USAGE,
              modelEcho: null,
              finish: "completed",
            });
          },
        },
      },
    }),
  };
}
