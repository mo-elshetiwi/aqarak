import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { app } from "../src/app";
import { createLocalIdentityProvider } from "../src/modules/identity/local-identity-provider";
import { setIdentityProvider } from "../src/modules/identity/runtime";

const configurationVariables = [
  "PORT",
  "STAGE",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "DATABASE_CLUSTER_ARN",
  "APP_SECRET_ARN",
  "DATABASE_NAME",
  "IDENTITY_PROVIDER",
  "LOCAL_IDENTITY_CONFIRMATION_CODE",
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_IDS",
  "PIPELINE_SECRET_ARN",
  "SCHEDULER_SECRET_ARN",
  "PROVIDER_KEYS_SECRET_ARN",
  "EMAIL_FROM_ADDRESS",
  "EMAIL_CONFIGURATION_SET",
  "APP_ORIGIN",
  "DOCUMENTS_BUCKET_NAME",
  "ISSUED_BUCKET_NAME",
  "AUDIT_ANCHORS_BUCKET_NAME",
] as const;

export function readLocalConfiguration(environment: NodeJS.ProcessEnv): {
  readonly port: number;
  readonly setVariables: readonly string[];
} {
  const portText = environment.PORT ?? "4000";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer from 0 to 65535");
  }
  return {
    port,
    setVariables: configurationVariables.filter((name) =>
      Boolean(environment[name]),
    ),
  };
}

export function startLocalServer(): ServerType {
  const { port, setVariables } = readLocalConfiguration(process.env);
  if (process.env.IDENTITY_PROVIDER === "local") {
    setIdentityProvider(
      createLocalIdentityProvider({
        confirmationCode: process.env.LOCAL_IDENTITY_CONFIRMATION_CODE ?? "",
      }),
    );
  }
  const server = serve(
    { fetch: app.fetch, port, hostname: "0.0.0.0" },
    (info) => {
      process.stdout.write(
        `Local API listening on port ${String(info.port)}; env set: ${setVariables.join(", ") || "none"}; identity provider: ${process.env.IDENTITY_PROVIDER === "local" ? "local" : "cognito"}\n`,
      );
    },
  );
  let closing = false;
  function shutdown(): void {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 5000).unref();
    server.close((error) => {
      clearTimeout(timeout);
      process.exitCode = error ? 1 : 0;
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  startLocalServer();
}
