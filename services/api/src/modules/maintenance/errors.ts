import { randomUUID } from "node:crypto";
import { DataApiError } from "@aqarak/db/data-api";
import { RDSDataServiceException } from "@aws-sdk/client-rds-data";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { Problem } from "./problem";

export async function unexpectedProblem(
  error: unknown,
  request: Request,
): Promise<Problem> {
  if (dependencyOutage(error))
    return new Problem(
      503,
      "SERVICE_UNAVAILABLE",
      "The requested service is unavailable.",
    );
  const sensitive = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string" && value) sensitive.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  };
  for (const value of request.headers.values()) collect(value);
  collect(
    request.headers.get("authorization")?.replace(/^(?:Bearer|Basic)\s+/iu, ""),
  );
  for (const value of new URL(request.url).searchParams.values())
    collect(value);
  for (const [key, value] of Object.entries(process.env))
    if (/secret|token|password|credential|api_key|access_key/i.test(key))
      collect(value);
  try {
    const body = await request.text();
    collect(body);
    try {
      collect(JSON.parse(body) as unknown);
    } catch {
      /* Non-JSON bodies are redacted as a whole. */
    }
  } catch {
    /* A consumed body contributes no diagnostic content. */
  }
  const scrub = (value: string): string => {
    let result = value;
    for (const secret of [...sensitive].sort((a, b) => b.length - a.length))
      result = result.split(secret).join("[redacted]");
    return result.replace(/[\r\n]/gu, " ").slice(0, 300);
  };
  process.stderr.write(
    `${JSON.stringify({ requestId: randomUUID(), route: new URL(request.url).pathname, name: scrub(error instanceof Error ? error.name : "UnknownError"), message: scrub(error instanceof Error ? error.message : "Unexpected error") })}\n`,
  );
  return new Problem(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function dependencyOutage(error: unknown): boolean {
  const dependency = error instanceof DataApiError ? error.cause : error;
  return (
    (dependency instanceof RDSDataServiceException &&
      (dependency.$fault === "server" ||
        /Unavailable|Resuming|Timeout/u.test(dependency.name))) ||
    (error instanceof S3ServiceException &&
      (error.$metadata.httpStatusCode ?? 0) >= 500)
  );
}
