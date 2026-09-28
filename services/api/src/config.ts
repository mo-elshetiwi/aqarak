import { z } from "zod";

const value = z.string().min(1);
const clientIds = z.string().transform((text, context) => {
  try {
    return z.object({ web: value, mobile: value }).parse(JSON.parse(text));
  } catch {
    context.addIssue({
      code: "custom",
      message: "Expected web and mobile client identifiers",
    });
    return z.NEVER;
  }
});
/** I validate the deployment contract before accepting an invocation. */
export const runtimeConfigSchema = z.object({
  DATABASE_CLUSTER_ARN: value,
  APP_SECRET_ARN: value,
  PIPELINE_SECRET_ARN: value,
  SCHEDULER_SECRET_ARN: value,
  DATABASE_NAME: value,
  DOCUMENTS_BUCKET_NAME: value,
  DOCUMENT_KEY_PREFIX: z.string().default(""),
  ISSUED_BUCKET_NAME: value,
  AUDIT_ANCHORS_BUCKET_NAME: value,
  COGNITO_USER_POOL_ID: value,
  COGNITO_CLIENT_IDS: clientIds,
  APP_ORIGIN: z.url(),
  EMAIL_FROM_ADDRESS: z.email(),
  EMAIL_CONFIGURATION_SET: value,
  PROVIDER_KEYS_SECRET_ARN: value,
  EXTRACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(24000)
    .default(20000),
  STAGE: z.enum(["local", "dev", "prod"]).default("local"),
  AWS_REGION: value,
});
const localConfigSchema = runtimeConfigSchema.partial().extend({
  DOCUMENT_KEY_PREFIX: z.string().default(""),
  EXTRACTION_TIMEOUT_MS: runtimeConfigSchema.shape.EXTRACTION_TIMEOUT_MS,
  STAGE: runtimeConfigSchema.shape.STAGE,
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  EMAIL_FROM_ADDRESS: z.union([z.email(), z.literal("")]).optional(),
  EMAIL_CONFIGURATION_SET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  AQARAK_LOCAL_IDENTITY_SECRET: z.string().optional(),
});
export type RuntimeConfig = z.infer<typeof localConfigSchema>;
let configuration: RuntimeConfig | undefined;
export function configFromEnvironment(env: NodeJS.ProcessEnv): RuntimeConfig {
  return localConfigSchema.parse(env);
}
export function initializeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const deployed = runtimeConfigSchema.parse(env);
  configuration = { ...configFromEnvironment(env), ...deployed };
  return configuration;
}
export function getConfig(): RuntimeConfig {
  return configuration ?? configFromEnvironment(process.env);
}
export function requiredConfig(name: keyof RuntimeConfig): string {
  const value = getConfig()[name];
  if (typeof value !== "string" || !value)
    throw new Error(`Missing configuration: ${name}`);
  return value;
}
