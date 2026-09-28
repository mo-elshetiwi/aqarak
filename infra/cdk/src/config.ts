import { Duration } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ObjectLockMode } from "aws-cdk-lib/aws-s3";
import { z } from "zod";

/** Keeps every environment difference explicit at the stage boundary. */
export interface EnvironmentConfig {
  readonly stage: "dev" | "prod";
  readonly account: string;
  readonly region: string;
  readonly availabilityZones: string[];
  readonly accessLogsExpiryDays: number;
  readonly logRetention: RetentionDays;
  readonly databaseMinCapacity: number;
  readonly databaseMaxCapacity: number;
  readonly databaseAutoPauseDuration?: Duration;
  readonly databaseBackupDays: number;
  readonly deletionProtection: boolean;
  readonly objectLockMode: ObjectLockMode;
  readonly objectLockDays: number;
  readonly corsOrigins: string[];
  readonly apiStageName: string;
  readonly throttleRate: number;
  readonly throttleBurst: number;
  readonly logLevel: "DEBUG" | "INFO";
  readonly email:
    | { readonly mode: "cognito" }
    | {
        readonly mode: "ses";
        readonly fromEmail: string;
        readonly verifiedDomain: string;
      };
}

export const devConfig: EnvironmentConfig = {
  stage: "dev",
  account: "000000000000",
  region: "us-east-1",
  availabilityZones: ["us-east-1a", "us-east-1b"],
  accessLogsExpiryDays: 90,
  logRetention: RetentionDays.ONE_MONTH,
  databaseMinCapacity: 0,
  databaseMaxCapacity: 4,
  databaseAutoPauseDuration: Duration.seconds(3600),
  databaseBackupDays: 7,
  deletionProtection: false,
  objectLockMode: ObjectLockMode.GOVERNANCE,
  objectLockDays: 30,
  corsOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://*.vercel.app",
    "https://aqarak.ae",
    "https://www.aqarak.ae",
  ],
  apiStageName: "dev",
  throttleRate: 50,
  throttleBurst: 100,
  logLevel: "DEBUG",
  email: { mode: "cognito" },
};

export const prodConfig: EnvironmentConfig = {
  stage: "prod",
  account: "000000000000",
  region: "us-east-1",
  availabilityZones: ["us-east-1a", "us-east-1b"],
  accessLogsExpiryDays: 400,
  logRetention: RetentionDays.ONE_YEAR,
  databaseMinCapacity: 0.5,
  databaseMaxCapacity: 4,
  databaseBackupDays: 35,
  deletionProtection: true,
  objectLockMode: ObjectLockMode.COMPLIANCE,
  objectLockDays: 1825,
  corsOrigins: ["https://aqarak.ae", "https://www.aqarak.ae"],
  apiStageName: "prod",
  throttleRate: 50,
  throttleBurst: 100,
  logLevel: "INFO",
  email: {
    mode: "ses",
    fromEmail: "no-reply@aqarak.ae",
    verifiedDomain: "aqarak.ae",
  },
};

/** Resolves deployment accounts without applying development credentials to production. */
export function getEnvironmentConfig(
  stage: EnvironmentConfig["stage"],
  context: Record<string, unknown> = {},
  defaultAccount = process.env.CDK_DEFAULT_ACCOUNT,
): EnvironmentConfig {
  const config = stage === "dev" ? devConfig : prodConfig;
  const account = z
    .string()
    .regex(/^\d{12}$/)
    .parse(
      context[`${stage}Account`] ??
        (stage === "dev" ? defaultAccount : undefined) ??
        config.account,
    );
  return { ...config, account };
}
