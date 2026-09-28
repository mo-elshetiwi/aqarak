import { expect, it } from "vitest";
import { loadConfig } from "./config";

it("parses and freezes configuration with data-relative defaults", () => {
  const config = loadConfig({ AQARAK_DATA_DIR: "/synthetic-data" });
  expect(Object.isFrozen(config)).toBe(true);
  expect(config).toMatchObject({
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    OLLAMA_HOST: "http://127.0.0.1:11434",
    AQARAK_PRIVATE_RUNS_DIR: "/synthetic-data/runs",
    AQARAK_WHISPER_MODELS_DIR: "/synthetic-data/models/faster-whisper",
    LIVE_MODELS: "0",
  });
  expect(config.OPENAI_API_KEY).toBeUndefined();
});
it("honors explicit paths and rejects malformed configuration without exposing values", () => {
  expect(
    loadConfig({
      AQARAK_DATA_DIR: "/data",
      AQARAK_PRIVATE_RUNS_DIR: "/private",
      AQARAK_WHISPER_MODELS_DIR: "/weights",
      AQARAK_EVAL_PYTHON: "/python",
      LIVE_MODELS: "1",
    }).AQARAK_PRIVATE_RUNS_DIR,
  ).toBe("/private");
  expect(() =>
    loadConfig({
      OPENAI_API_KEY: "sensitive-fixture",
      OPENAI_BASE_URL: "invalid-sensitive-value",
    }),
  ).toThrow("Invalid evaluation environment configuration");
  expect(() =>
    loadConfig({ AQARAK_DATA_DIR: "/data", LIVE_MODELS: "true" }),
  ).toThrow();
});
