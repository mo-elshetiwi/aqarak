import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "@hono/zod-openapi";
export class EstateProblem extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly field?: string,
    detail?: string,
  ) {
    super(detail ?? code.replaceAll("_", " ").toLowerCase());
  }
}
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  code: z.string(),
  traceId: z.string(),
  field: z.string().optional(),
});
export function problemResponse(
  c: Context,
  error: EstateProblem,
  traceId = randomUUID(),
): Response {
  return c.newResponse(
    JSON.stringify({
      type: `urn:aqarak:problem:${error.code.toLowerCase()}`,
      title: error.code,
      status: error.status,
      detail: error.message,
      code: error.code,
      traceId,
      ...(error.field ? { field: error.field } : {}),
    }),
    error.status,
    { "Content-Type": "application/problem+json" },
  );
}
export function fail(
  status: ContentfulStatusCode,
  code: string,
  field?: string,
  detail?: string,
): never {
  throw new EstateProblem(status, code, field, detail);
}
