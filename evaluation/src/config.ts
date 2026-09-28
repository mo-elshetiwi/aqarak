import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  OLLAMA_HOST: z.url().default("http://127.0.0.1:11434"),
  AQARAK_EVAL_PYTHON: z
    .string()
    .min(1)
    .default(join(homedir(), ".venvs/aqarak-eval/bin/python")),
  AQARAK_DATA_DIR: z.string().min(1),
  AQARAK_PRIVATE_RUNS_DIR: z.string().min(1).optional(),
  AQARAK_WHISPER_MODELS_DIR: z.string().min(1).optional(),
  LIVE_MODELS: z.enum(["0", "1"]).default("0"),
});
export interface EvaluationConfig {
  readonly OPENAI_API_KEY?: string;
  readonly OPENAI_BASE_URL: string;
  readonly OLLAMA_HOST: string;
  readonly AQARAK_EVAL_PYTHON: string;
  readonly AQARAK_DATA_DIR: string;
  readonly AQARAK_PRIVATE_RUNS_DIR: string;
  readonly AQARAK_WHISPER_MODELS_DIR: string;
  readonly LIVE_MODELS: "0" | "1";
}
/** Validate environment configuration without exposing rejected values. */
export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): EvaluationConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success)
    throw new Error("Invalid evaluation environment configuration");
  const value = parsed.data;
  const dataDir = resolve(value.AQARAK_DATA_DIR);
  return Object.freeze({
    ...(value.OPENAI_API_KEY ? { OPENAI_API_KEY: value.OPENAI_API_KEY } : {}),
    OPENAI_BASE_URL: value.OPENAI_BASE_URL,
    OLLAMA_HOST: value.OLLAMA_HOST,
    AQARAK_EVAL_PYTHON: value.AQARAK_EVAL_PYTHON,
    AQARAK_DATA_DIR: dataDir,
    AQARAK_PRIVATE_RUNS_DIR: resolve(
      value.AQARAK_PRIVATE_RUNS_DIR ?? join(dataDir, "runs"),
    ),
    AQARAK_WHISPER_MODELS_DIR: resolve(
      value.AQARAK_WHISPER_MODELS_DIR ?? join(dataDir, "models/faster-whisper"),
    ),
    LIVE_MODELS: value.LIVE_MODELS,
  });
}
/** Gate live smoke tests through the single environment-reading module. */
export function liveModelsEnabled(): boolean {
  return process.env.LIVE_MODELS === "1";
}
