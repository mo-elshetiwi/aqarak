import { z } from "zod";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const problemStatuses = {
  VALIDATION_FAILED: 400,
  EMAIL_TAKEN: 409,
  PASSWORD_POLICY: 400,
  RATE_LIMITED: 429,
  CODE_MISMATCH: 400,
  CODE_EXPIRED: 400,
  INVALID_CREDENTIALS: 401,
  USER_NOT_CONFIRMED: 403,
  SESSION_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNAVAILABLE: 503,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  LAST_ADMINISTRATOR: 409,
  ACTIVE_MEMBERSHIP_ELSEWHERE: 409,
  INVITATION_NOT_PENDING: 409,
  INVITATION_EMAIL_MISMATCH: 403,
  INVITATION_EXISTS: 409,
  PARTY_ALREADY_LINKED: 409,
} as const;
export type ProblemCode = keyof typeof problemStatuses;
export class Refusal extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly reason: string = code,
  ) {
    super(code);
    this.name = "Refusal";
  }
}
export function problem(context: Context, code: ProblemCode): Response {
  const status = problemStatuses[code];
  return context.newResponse(
    JSON.stringify({
      type: "about:blank",
      title: code.replaceAll("_", " "),
      status,
      code,
    }),
    status as ContentfulStatusCode,
    { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
  );
}
export async function body<T>(
  context: Context,
  schema: z.ZodType<T>,
): Promise<T> {
  const value: unknown = await context.req.json().catch(() => null);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Refusal("VALIDATION_FAILED");
  return parsed.data;
}
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
