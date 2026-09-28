import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { configFromEnvironment, getConfig } from "../../../config";
import { createAuthenticator, type Authenticator } from "./authentication";
import { Refusal } from "./problems";

export interface KernelDependencies {
  readonly database: DataApiExecutor;
  readonly pipelineDatabase: DataApiExecutor | null;
  readonly s3: S3Client;
  readonly buckets: {
    readonly documents: string | null;
    readonly auditAnchors: string | null;
  };
  readonly keyPrefix: string;
  readonly authenticator: Authenticator;
  readonly now: () => Date;
}
/** I consume the shared configuration for cloud and isolated fixtures. */
export function kernelDependenciesFromEnvironment(
  env?: NodeJS.ProcessEnv,
): KernelDependencies {
  const config = env ? configFromEnvironment(env) : getConfig();
  if (
    !config.DATABASE_CLUSTER_ARN ||
    !config.APP_SECRET_ARN ||
    !config.DATABASE_NAME ||
    !config.AWS_REGION
  )
    throw new Refusal("UNAVAILABLE", null);
  const client = new RDSDataClient({ region: config.AWS_REGION });
  const connection = {
    client,
    resourceArn: config.DATABASE_CLUSTER_ARN,
    database: config.DATABASE_NAME,
  };
  return {
    database: createDataApiExecutor({
      ...connection,
      secretArn: config.APP_SECRET_ARN,
    }),
    pipelineDatabase: config.PIPELINE_SECRET_ARN
      ? createDataApiExecutor({
          ...connection,
          secretArn: config.PIPELINE_SECRET_ARN,
        })
      : null,
    s3: new S3Client({ region: config.AWS_REGION }),
    buckets: {
      documents: config.DOCUMENTS_BUCKET_NAME ?? null,
      auditAnchors: config.AUDIT_ANCHORS_BUCKET_NAME ?? null,
    },
    keyPrefix: config.DOCUMENT_KEY_PREFIX,
    authenticator: createAuthenticator(),
    now: () => new Date(),
  };
}
