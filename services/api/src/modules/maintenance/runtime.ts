import { getConfig } from "../../config";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { z } from "zod";
import { createStorage, type StoragePort } from "../media/storage";
import { createAuthenticator, type Authenticator } from "./auth";
import { recordDenial, type RequestScope } from "./access";
import {
  Denied,
  Problem,
  problemResponse,
  requiredEnvironment,
} from "./problem";
import {
  createProductionIntakeModels,
  type IntakeModels,
} from "./intake-models";
import { unexpectedProblem } from "./errors";
import type { CommandResponse } from "./idempotency";

export interface MaintenanceDependencies {
  now?: () => number;
  authenticate?: Authenticator;
  models?: IntakeModels;
  db?: DataApiExecutor;
  storage?: StoragePort;
  bucket?: string;
  prefix?: string;
}
export interface Runtime {
  now: () => number;
  models: () => IntakeModels;
  db: () => DataApiExecutor;
  storage: () => StoragePort;
  location: () => { bucket: string; prefix: string };
  handle: (
    request: Request,
    company: string | undefined,
    work: (scope: RequestScope) => Promise<CommandResponse>,
  ) => Promise<Response>;
}
export function createRuntime(deps: MaintenanceDependencies = {}): Runtime {
  const authenticate = deps.authenticate ?? createAuthenticator();
  let models = deps.models;
  let db = deps.db;
  let storage = deps.storage;
  const runtime: Runtime = {
    now: deps.now ?? Date.now,
    models() {
      models ??= createProductionIntakeModels();
      return models;
    },
    db() {
      db ??= createDataApiExecutor({
        resourceArn: requiredEnvironment("DATABASE_CLUSTER_ARN"),
        secretArn: requiredEnvironment("APP_SECRET_ARN"),
        database: requiredEnvironment("DATABASE_NAME"),
        client: new RDSDataClient({
          region: requiredEnvironment("AWS_REGION"),
          maxAttempts: 1,
        }),
      });
      return db;
    },
    storage() {
      storage ??= createStorage(
        new S3Client({
          region: requiredEnvironment("AWS_REGION"),
          maxAttempts: 1,
        }),
      );
      return storage;
    },
    location() {
      return {
        bucket: deps.bucket ?? requiredEnvironment("DOCUMENTS_BUCKET_NAME"),
        prefix: deps.prefix ?? getConfig().DOCUMENT_KEY_PREFIX,
      };
    },
    async handle(request, company, work) {
      let scope: RequestScope | undefined;
      const diagnosticRequest = request.clone();
      try {
        const identity = await authenticate(request);
        if (!identity || !z.uuid().safeParse(identity.subject).success)
          throw new Problem(
            401,
            "UNAUTHENTICATED",
            "Authentication is required.",
          );
        const path = z.uuid().safeParse(company);
        if (!path.success)
          throw new Problem(
            400,
            "INVALID_REQUEST",
            "A valid companyId is required.",
            { field: "companyId" },
          );
        scope = {
          companyId: path.data,
          subject: identity.subject,
          channel: "mobile_form",
        };
        const response = await work(scope);
        return Response.json(response.body, {
          status: response.status,
          headers: {
            ...(response.replayed ? { "Idempotent-Replayed": "true" } : {}),
            ...(response.status >= 400
              ? { "Content-Type": "application/problem+json" }
              : {}),
          },
        });
      } catch (error) {
        if (error instanceof Denied && scope) {
          try {
            await recordDenial(runtime.db(), scope, error);
          } catch {
            return problemResponse(
              new Problem(
                503,
                "SERVICE_UNAVAILABLE",
                "The audit service is unavailable.",
              ),
            );
          }
        }
        return problemResponse(
          error instanceof Problem
            ? error
            : await unexpectedProblem(error, diagnosticRequest),
        );
      }
    },
  };
  return runtime;
}
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new Problem(
      400,
      "INVALID_REQUEST",
      "A JSON request body is required.",
    );
  }
}
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Problem(
      400,
      "INVALID_REQUEST",
      "The request does not match the required schema.",
      { field: String(result.error.issues[0]?.path[0] ?? "body") },
    );
  return result.data;
}
