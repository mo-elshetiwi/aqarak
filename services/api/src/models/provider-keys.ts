import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import { getConfig } from "../config";

interface SecretClient {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}
/** I resolve the credential once per execution environment without logging it. */
export function createProviderKeyResolver(client: SecretClient) {
  let pending: Promise<string | undefined> | undefined;
  return (options: {
    directKey?: string;
    secretArn?: string;
  }): Promise<string | undefined> => {
    pending ??= (async () => {
      if (options.directKey) return options.directKey;
      if (!options.secretArn) return undefined;
      const result = await client.send(
        new GetSecretValueCommand({ SecretId: options.secretArn }),
      );
      const secret = z
        .object({ openai: z.string().optional() })
        .parse(JSON.parse(result.SecretString ?? "{}"));
      return secret.openai === "" ? undefined : secret.openai;
    })();
    return pending;
  };
}
let resolvedKey: string | undefined;
let initialization: Promise<void> | undefined;
export function initializeProviderKeys(): Promise<void> {
  initialization ??= (async () => {
    const config = getConfig();
    resolvedKey = await createProviderKeyResolver(
      new SecretsManagerClient({
        ...(config.AWS_REGION ? { region: config.AWS_REGION } : {}),
        maxAttempts: 1,
      }),
    )({
      ...(config.OPENAI_API_KEY ? { directKey: config.OPENAI_API_KEY } : {}),
      ...(config.PROVIDER_KEYS_SECRET_ARN
        ? { secretArn: config.PROVIDER_KEYS_SECRET_ARN }
        : {}),
    });
  })();
  return initialization;
}
export function getProviderKey(): string | undefined {
  return resolvedKey ?? getConfig().OPENAI_API_KEY;
}
