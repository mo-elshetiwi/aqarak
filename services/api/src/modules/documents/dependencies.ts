import { getConfig, type RuntimeConfig } from "../../config";
import { getProviderKey } from "../../models/provider-keys";
import { authenticateRequest } from "../identity/adapters";
import { randomBytes } from "node:crypto";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import { createDataApiExecutor } from "@aqarak/db/data-api";
import {
  createModelGateway,
  createOpenAiResponsesAdapter,
  modelRegistrySchema,
} from "../../models";
import { type J3Dependencies } from "./context";
import { createS3Storage } from "./s3-storage";
import registryData from "../../models/model-registry.json";

function required(name: keyof RuntimeConfig): string {
  const value = getConfig()[name];
  if (typeof value !== "string" || !value)
    throw new Error(`Missing configuration: ${name}`);
  return value;
}
export function createProductionDependencies(): J3Dependencies {
  const region = required("AWS_REGION");
  const connection = {
    resourceArn: required("DATABASE_CLUSTER_ARN"),
    database: required("DATABASE_NAME"),
    client: new RDSDataClient({ region }),
  };
  const registry = modelRegistrySchema.parse(registryData);
  const apiKey = getProviderKey();
  const now = (): Date => new Date();
  return {
    authenticate: authenticateRequest,
    appExecutor: createDataApiExecutor({
      ...connection,
      secretArn: required("APP_SECRET_ARN"),
    }),
    pipelineExecutor: getConfig().PIPELINE_SECRET_ARN
      ? createDataApiExecutor({
          ...connection,
          secretArn: required("PIPELINE_SECRET_ARN"),
        })
      : null,
    storage: createS3Storage({
      client: new S3Client({ region }),
      bucket: required("DOCUMENTS_BUCKET_NAME"),
      keyPrefix: getConfig().DOCUMENT_KEY_PREFIX,
      now,
    }),
    extraction: apiKey
      ? {
          registry,
          gateway: createModelGateway({
            registry,
            now,
            structuredAdapters: {
              openai_responses: createOpenAiResponsesAdapter({
                apiKey,
                baseUrl: "https://api.openai.com/v1",
                fetch: globalThis.fetch,
              }),
            },
            transcriptionAdapters: {},
          }),
        }
      : null,
    now,
    randomBytes,
  };
}
export function lazyDependencies(): () => J3Dependencies {
  let dependencies: J3Dependencies | undefined;
  return () => {
    dependencies ??= createProductionDependencies();
    return dependencies;
  };
}
