import { resolve } from "node:path";
import {
  CfnOutput,
  Duration,
  Stack,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IKey } from "aws-cdk-lib/aws-kms";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";
import type { DataStack } from "./data-stack";

export interface DatabaseOpsStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly data: DataStack;
  readonly dataKey: IKey;
}

export class DatabaseOpsStack extends Stack {
  readonly migrateFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: DatabaseOpsStackProps) {
    super(scope, id, props);
    const { config, data, dataKey } = props;
    const root = resolve(import.meta.dirname, "../../../..");
    const logGroup = new LogGroup(this, "MigrateDatabaseFunctionLogs", {
      retention: config.logRetention,
    });
    this.migrateFunction = new NodejsFunction(this, "MigrateDatabaseFunction", {
      entry: resolve(root, "services/workers/src/handlers/migrate-database.ts"),
      handler: "handler",
      projectRoot: root,
      depsLockFilePath: resolve(root, "pnpm-lock.yaml"),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 512,
      logGroup,
      bundling: {
        sourceMap: true,
        forceDockerBundling: false,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir, outputDir) => [
            `cp -R "${inputDir}/packages/db/migrations" "${outputDir}/migrations"`,
          ],
        },
      },
      environment: {
        DATABASE_CLUSTER_ARN: data.cluster.clusterArn,
        DATABASE_NAME: data.databaseName,
        MASTER_SECRET_ARN: data.masterSecret.secretArn,
        APP_SECRET_ARN: data.appSecret.secretArn,
        PIPELINE_SECRET_ARN: data.pipelineSecret.secretArn,
        SCHEDULER_SECRET_ARN: data.schedulerSecret.secretArn,
        POWERTOOLS_SERVICE_NAME: "database-ops",
        POWERTOOLS_LOG_LEVEL: config.logLevel,
      },
    });
    this.migrateFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "rds-data:ExecuteStatement",
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:RollbackTransaction",
        ],
        resources: [data.cluster.clusterArn],
      }),
    );
    for (const [name, secret] of [
      ["MasterDatabaseSecret", data.masterSecret],
      ["AppDatabaseSecret", data.appSecret],
      ["PipelineDatabaseSecret", data.pipelineSecret],
      ["SchedulerDatabaseSecret", data.schedulerSecret],
    ] as const) {
      // I keep the grant in this stack to avoid a reverse key-policy dependency.
      Secret.fromSecretCompleteArn(this, name, secret.secretArn).grantRead(
        this.migrateFunction,
      );
    }
    this.migrateFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [dataKey.keyArn],
      }),
    );
    Validations.of(
      this.migrateFunction.node.findChild("ServiceRole"),
    ).acknowledge({
      id: "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
      reason:
        "The standard Lambda basic execution policy provides runtime log delivery; database permissions are limited to the cluster, four secrets and their encryption key.",
    });
    new CfnOutput(this, "MigrateFunctionName", {
      value: this.migrateFunction.functionName,
    });
  }
}
