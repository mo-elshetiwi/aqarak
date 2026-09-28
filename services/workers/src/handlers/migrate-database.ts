import { Logger } from "@aws-lambda-powertools/logger";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import {
  loadMigrations,
  MigrationStatementError,
  runMigrations,
  type Migration,
  type MigrationSummary,
} from "@aqarak/db/migrate";
import { bootstrapRoles, type ReadSecret } from "@aqarak/db/roles";
import { measureLatency, type LatencyResult } from "@aqarak/db/spike";

export interface MigrationEvent {
  action?: string;
}
export interface HandlerEnvironment {
  DATABASE_CLUSTER_ARN: string;
  DATABASE_NAME: string;
  MASTER_SECRET_ARN: string;
  APP_SECRET_ARN: string;
  PIPELINE_SECRET_ARN: string;
  SCHEDULER_SECRET_ARN: string;
  MIGRATIONS_DIR: string;
  AWS_REGION: string;
}
export interface HandlerDependencies {
  environment: HandlerEnvironment;
  executor: (secretArn: string) => DataApiExecutor;
  readSecret: ReadSecret;
  load: (dir: string) => Promise<Migration[]>;
  log: (summary: Record<string, unknown>) => void;
  logError: (message: string) => void;
}
export type HandlerSummary =
  | { action: "migrate"; roles: string[]; migrations: MigrationSummary }
  | { action: "measure-latency"; latency: LatencyResult };
export function createHandler(
  dependencies: HandlerDependencies,
): (event: MigrationEvent) => Promise<HandlerSummary> {
  return async (event) => {
    const { environment, executor } = dependencies;
    const action = event.action ?? "migrate";
    if (action === "measure-latency") {
      const latency = await measureLatency(
        executor(environment.APP_SECRET_ARN),
        `Lambda client in ${environment.AWS_REGION}`,
      );
      const summary: HandlerSummary = { action, latency };
      dependencies.log({ action, samples: latency.samples });
      return summary;
    }
    if (action !== "migrate")
      throw new Error("Unsupported database worker action");
    const master = executor(environment.MASTER_SECRET_ARN);
    const { roles } = await bootstrapRoles(
      master,
      [
        { role: "aqarak_app", secretArn: environment.APP_SECRET_ARN },
        { role: "aqarak_pipeline", secretArn: environment.PIPELINE_SECRET_ARN },
        {
          role: "aqarak_scheduler",
          secretArn: environment.SCHEDULER_SECRET_ARN,
        },
      ],
      dependencies.readSecret,
    ).catch(() => {
      throw new Error("Database role bootstrap failed");
    });
    let migrations: MigrationSummary;
    try {
      migrations = await runMigrations(
        master,
        await dependencies.load(environment.MIGRATIONS_DIR),
      );
    } catch (error) {
      if (error instanceof MigrationStatementError) {
        dependencies.logError(error.message);
        throw error;
      }
      throw new Error("Database migration failed");
    }
    const summary: HandlerSummary = { action, roles, migrations };
    dependencies.log({
      action,
      roles,
      applied: migrations.applied,
      skipped: migrations.skipped,
    });
    return summary;
  };
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
function environment(): HandlerEnvironment {
  return {
    DATABASE_CLUSTER_ARN: required("DATABASE_CLUSTER_ARN"),
    DATABASE_NAME: required("DATABASE_NAME"),
    MASTER_SECRET_ARN: required("MASTER_SECRET_ARN"),
    APP_SECRET_ARN: required("APP_SECRET_ARN"),
    PIPELINE_SECRET_ARN: required("PIPELINE_SECRET_ARN"),
    SCHEDULER_SECRET_ARN: required("SCHEDULER_SECRET_ARN"),
    MIGRATIONS_DIR:
      process.env.MIGRATIONS_DIR ??
      `${required("LAMBDA_TASK_ROOT")}/migrations`,
    AWS_REGION: process.env.AWS_REGION ?? "us-east-1",
  };
}
export async function handler(
  event: MigrationEvent = {},
): Promise<HandlerSummary> {
  const env = environment();
  const logger = new Logger({ serviceName: "database-ops" });
  const data = new RDSDataClient({ region: env.AWS_REGION, maxAttempts: 1 });
  const secrets = new SecretsManagerClient({ region: env.AWS_REGION });
  const run = createHandler({
    environment: env,
    executor: (secretArn) =>
      createDataApiExecutor({
        resourceArn: env.DATABASE_CLUSTER_ARN,
        database: env.DATABASE_NAME,
        secretArn,
        client: data,
      }),
    readSecret: async (arn) => {
      const secret = await secrets.send(
        new GetSecretValueCommand({ SecretId: arn }),
      );
      if (!secret.SecretString)
        throw new Error("Runtime secret must contain JSON text");
      return secret.SecretString;
    },
    load: loadMigrations,
    log: (summary) => {
      logger.info("Database worker completed", summary);
    },
    logError: (message) => {
      logger.error(message);
    },
  });
  try {
    return await run(event);
  } catch (error) {
    if (error instanceof MigrationStatementError) throw error;
    // Bootstrap and other raw failures can contain credential material.
    logger.error("Database worker failed");
    throw new Error("Database worker failed");
  } finally {
    data.destroy();
    secrets.destroy();
  }
}
