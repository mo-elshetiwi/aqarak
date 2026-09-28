import { z } from "zod";
import { getEnvironmentConfig } from "./config";

/** Exposes identifiers required by applications without exporting credentials. */
export const environmentOutputsSchema = z.strictObject({
  stage: z.enum(["dev", "prod"]),
  region: z.literal("us-east-1"),
  apiUrl: z.url().startsWith("https://").endsWith("/"),
  userPoolId: z.string().regex(/^us-east-1_[A-Za-z0-9]+$/),
  webClientId: z.string().regex(/^[a-z0-9]+$/),
  mobileClientId: z.string().regex(/^[a-z0-9]+$/),
  documentsBucketName: z.string().min(3),
  issuedBucketName: z.string().min(3),
  auditAnchorsBucketName: z.string().min(3),
  clusterArn: z.string().regex(/^arn:aws:rds:us-east-1:\d{12}:cluster:.+$/),
  appSecretArn: z
    .string()
    .regex(/^arn:aws:secretsmanager:us-east-1:\d{12}:secret:.+$/),
  pipelineSecretArn: z
    .string()
    .regex(/^arn:aws:secretsmanager:us-east-1:\d{12}:secret:.+$/)
    .optional(),
  schedulerSecretArn: z
    .string()
    .regex(/^arn:aws:secretsmanager:us-east-1:\d{12}:secret:.+$/)
    .optional(),
  providerKeysSecretArn: z
    .string()
    .regex(/^arn:aws:secretsmanager:us-east-1:\d{12}:secret:.+$/)
    .optional(),
  databaseName: z.literal("aqarak"),
  emailConfigurationSetName: z.string().min(1),
});
export type EnvironmentOutputs = z.infer<typeof environmentOutputsSchema>;

const rawOutputsSchema = z.record(z.string(), z.record(z.string(), z.string()));

/** Selects only the application contract from the deployment outputs. */
export function mapDevOutputs(
  raw: unknown,
  account = getEnvironmentConfig("dev").account,
): EnvironmentOutputs {
  const stacks = rawOutputsSchema.parse(raw);
  const readOutput = (name: string): string => {
    const matches = Object.values(stacks).flatMap((stack) =>
      stack[name] === undefined ? [] : [stack[name]],
    );
    if (matches.length !== 1)
      throw new Error(`Expected exactly one ${name} output`);
    return z.string().parse(matches[0]);
  };
  const result = environmentOutputsSchema.parse({
    stage: "dev",
    region: "us-east-1",
    apiUrl: readOutput("ApiUrl"),
    userPoolId: readOutput("UserPoolId"),
    webClientId: readOutput("WebClientId"),
    mobileClientId: readOutput("MobileClientId"),
    documentsBucketName: readOutput("DocumentsBucketName"),
    issuedBucketName: readOutput("IssuedBucketName"),
    auditAnchorsBucketName: readOutput("AuditAnchorsBucketName"),
    clusterArn: readOutput("ClusterArn"),
    appSecretArn: readOutput("AppSecretArn"),
    databaseName: readOutput("DatabaseName"),
    pipelineSecretArn: readOutput("PipelineSecretArn"),
    schedulerSecretArn: readOutput("SchedulerSecretArn"),
    providerKeysSecretArn: readOutput("ProviderKeysSecretArn"),
    emailConfigurationSetName: readOutput("EmailConfigurationSetName"),
  });
  developmentAccount(result, account);
  return result;
}

export function serialiseOutputs(outputs: EnvironmentOutputs): string {
  return `${JSON.stringify(Object.fromEntries(Object.entries(environmentOutputsSchema.parse(outputs)).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`;
}

/** Checks that every development ARN belongs to the selected account. */
export function developmentAccount(
  outputs: EnvironmentOutputs,
  expectedAccount = process.env.CDK_DEFAULT_ACCOUNT ??
    outputs.clusterArn.split(":")[4],
): string {
  const account = z
    .string()
    .regex(/^\d{12}$/)
    .parse(expectedAccount);
  const arns = [
    outputs.clusterArn,
    outputs.appSecretArn,
    outputs.pipelineSecretArn,
    outputs.schedulerSecretArn,
    outputs.providerKeysSecretArn,
  ];
  if (
    outputs.stage !== "dev" ||
    arns.some((arn) => arn !== undefined && arn.split(":")[4] !== account)
  ) {
    throw new Error(`Development outputs must belong to account ${account}`);
  }
  return account;
}
