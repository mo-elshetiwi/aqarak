import { getConfig, type RuntimeConfig } from "../../config";
import { z } from "zod";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { createDataApiExecutor } from "@aqarak/db/data-api";
import { createCognitoIdentityProvider } from "./cognito-identity-provider";
import {
  createDisabledEmailSender,
  createSesEmailSender,
} from "./email-sender";
import type { Dependencies, IdentityProvider } from "./ports";
let instance: Dependencies | undefined;
let override: IdentityProvider | undefined;
export function setIdentityProvider(provider: IdentityProvider): void {
  if (instance)
    throw new Error("Identity dependencies are already initialized");
  override = provider;
}
function required(name: keyof RuntimeConfig): string {
  const value = getConfig()[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name}`);
  return value;
}
export function runtimeDependencies(): Dependencies {
  if (instance) return instance;
  const cognito = new CognitoIdentityProviderClient({});
  const ses = new SESv2Client({});
  instance = {
    executor: createDataApiExecutor({
      client: new RDSDataClient({}),
      resourceArn: required("DATABASE_CLUSTER_ARN"),
      secretArn: required("APP_SECRET_ARN"),
      database: required("DATABASE_NAME"),
    }),
    identityProvider:
      override ??
      createCognitoIdentityProvider({
        poolId: required("COGNITO_USER_POOL_ID"),
        webClientId: z.string().parse(getConfig().COGNITO_CLIENT_IDS?.web),
        mobileClientId: z
          .string()
          .parse(getConfig().COGNITO_CLIENT_IDS?.mobile),
        send: (command) => {
          if (command instanceof AdminGetUserCommand)
            return cognito.send(command);
          if (command instanceof AdminInitiateAuthCommand)
            return cognito.send(command);
          if (command instanceof ConfirmSignUpCommand)
            return cognito.send(command);
          if (command instanceof ResendConfirmationCodeCommand)
            return cognito.send(command);
          if (command instanceof RevokeTokenCommand)
            return cognito.send(command);
          return cognito.send(command);
        },
      }),
    emailSender: getConfig().EMAIL_FROM_ADDRESS
      ? createSesEmailSender({
          from: required("EMAIL_FROM_ADDRESS"),
          configurationSetName: getConfig().EMAIL_CONFIGURATION_SET,
          send: (command) => ses.send(command),
        })
      : createDisabledEmailSender(),
    clock: () => new Date(),
    appOrigin: getConfig().APP_ORIGIN,
  };
  return instance;
}
