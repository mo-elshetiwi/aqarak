import { getConfig, type RuntimeConfig } from "../../../config";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { WorkflowProblem } from "./problem";
import type { ModelGateway } from "../../../models/contracts";

export interface WorkflowDependencies {
  executor: DataApiExecutor;
  schedulerExecutor: DataApiExecutor;
  emailClient: SESv2Client;
  modelGateway: ModelGateway | null;
  clock: () => Date;
}
function required(name: keyof RuntimeConfig): string {
  const value = getConfig()[name];
  if (typeof value !== "string" || !value)
    throw new WorkflowProblem("UNAVAILABLE");
  return value;
}
function executor(secret: keyof RuntimeConfig): DataApiExecutor {
  return createDataApiExecutor({
    resourceArn: required("DATABASE_CLUSTER_ARN"),
    secretArn: required(secret),
    database: required("DATABASE_NAME"),
    client: new RDSDataClient({
      region: required("AWS_REGION"),
      maxAttempts: 1,
    }),
  });
}
export function dependencyFactory(
  overrides: Partial<WorkflowDependencies> = {},
): () => WorkflowDependencies {
  let cached: WorkflowDependencies | undefined;
  let appExecutor = overrides.executor;
  let schedulerExecutor = overrides.schedulerExecutor;
  let emailClient = overrides.emailClient;
  return () => {
    cached ??= {
      get executor() {
        return (appExecutor ??= executor("APP_SECRET_ARN"));
      },
      get schedulerExecutor() {
        return (schedulerExecutor ??= executor("SCHEDULER_SECRET_ARN"));
      },
      get emailClient() {
        return (emailClient ??= new SESv2Client({
          region: required("AWS_REGION"),
        }));
      },
      modelGateway: overrides.modelGateway ?? null,
      clock: overrides.clock ?? (() => new Date()),
    };
    return cached;
  };
}
