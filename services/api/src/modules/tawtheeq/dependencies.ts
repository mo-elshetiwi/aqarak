import { configFromEnvironment } from "../../config";
import { getProviderKey } from "../../models/provider-keys";
import {
  kernelDependenciesFromEnvironment,
  type KernelDependencies,
} from "../audit/kernel";
import { createModelGateway } from "../../models/gateway";
import {
  loadModelRegistry,
  modelRegistrySchema,
  type ModelRegistry,
} from "../../models/registry";
import { createOpenAiResponsesAdapter } from "../../models/adapters/openai-responses";
import registrySource from "../../models/model-registry.json";
import type { ModelGateway } from "../../models/contracts";

export interface TawtheeqDependencies extends KernelDependencies {
  readonly gateway: ModelGateway | null;
  readonly registry: ModelRegistry;
}
export function dependenciesFromEnvironment(
  env?: NodeJS.ProcessEnv,
): TawtheeqDependencies {
  const kernel = kernelDependenciesFromEnvironment(env);
  const apiKey = env
    ? configFromEnvironment(env).OPENAI_API_KEY
    : getProviderKey();
  let registry: ModelRegistry;
  try {
    registry = loadModelRegistry();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    registry = modelRegistrySchema.parse(registrySource);
  }
  return {
    ...kernel,
    registry,
    gateway: apiKey
      ? createModelGateway({
          registry,
          structuredAdapters: {
            openai_responses: createOpenAiResponsesAdapter({
              apiKey,
              baseUrl: "https://api.openai.com/v1",
              fetch: globalThis.fetch,
            }),
          },
          transcriptionAdapters: {},
          now: kernel.now,
        })
      : null,
  };
}
