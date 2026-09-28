import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createModelGateway,
  createOpenAiResponsesAdapter,
  getCandidate,
  loadModelRegistry,
} from "@aqarak/api/models";
import { loadConfig, liveModelsEnabled } from "./config";
import { createOllamaAdapter, verifyOllamaDigest } from "./adapters/ollama";

// Live calls require explicit opt-in, with environment access confined to configuration.
describe.skipIf(!liveModelsEnabled())(
  "live structured screening smokes",
  () => {
    it.each(["openai_responses", "ollama"] as const)(
      "returns a tiny strict result from %s",
      async (provider) => {
        const config = loadConfig();
        const registry = loadModelRegistry();
        const classId = "mc1_document_extraction";
        const candidateId = Object.entries(
          registry.classes[classId].candidates,
        ).find(([, value]) => value.provider === provider)?.[0];
        if (!candidateId) throw new Error("Missing smoke candidate");
        const candidate = getCandidate(registry, classId, candidateId);
        if (provider === "openai_responses" && !config.OPENAI_API_KEY)
          throw new Error("Missing provider configuration");
        if (provider === "ollama") {
          if (candidate.version.digest === null)
            throw new Error("Missing digest");
          await verifyOllamaDigest({
            host: config.OLLAMA_HOST,
            fetch: globalThis.fetch,
            modelId: candidate.modelId,
            expectedDigest: candidate.version.digest,
          });
        }
        const gateway = createModelGateway({
          registry,
          structuredAdapters: {
            openai_responses: createOpenAiResponsesAdapter({
              apiKey: config.OPENAI_API_KEY ?? "",
              baseUrl: config.OPENAI_BASE_URL,
              fetch: globalThis.fetch,
            }),
            ollama: createOllamaAdapter({
              host: config.OLLAMA_HOST,
              fetch: globalThis.fetch,
            }),
          },
          transcriptionAdapters: {},
          now: () => new Date(),
        });
        const result = await gateway.generateStructured({
          classId,
          candidateId,
          promptId: "smoke",
          promptVersion: 1,
          instructions: "Return the requested synthetic value.",
          userText: "Return value ok.",
          images: [],
          schemaId: "smoke",
          schema: z.strictObject({ value: z.string() }),
        });
        expect(result.record.status).toBe("ok");
      },
      950000,
    );
  },
);
