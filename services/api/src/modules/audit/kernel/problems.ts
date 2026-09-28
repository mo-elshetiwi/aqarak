export type ProblemCode =
  | "VALIDATION_FAILED"
  | "SESSION_INVALID"
  | "NOT_PERMITTED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "STALE_VERSION"
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAVAILABLE";

const problems: Record<ProblemCode, readonly [number, string, string]> = {
  VALIDATION_FAILED: [
    400,
    "Bad Request",
    "The request does not match the required schema.",
  ],
  SESSION_INVALID: [401, "Unauthorized", "A valid session is required."],
  NOT_PERMITTED: [403, "Forbidden", "This action is not permitted."],
  NOT_FOUND: [404, "Not Found", "The requested resource was not found."],
  METHOD_NOT_ALLOWED: [
    405,
    "Method Not Allowed",
    "Audit events cannot be changed or deleted.",
  ],
  STALE_VERSION: [
    409,
    "Conflict",
    "The record has changed. Reload it before trying again.",
  ],
  INVALID_TRANSITION: [
    409,
    "Conflict",
    "The requested transition is not available.",
  ],
  REASON_REQUIRED: [
    422,
    "Unprocessable Content",
    "A nonempty reason is required.",
  ],
  IDEMPOTENCY_KEY_REUSED: [
    422,
    "Unprocessable Content",
    "This key was already used for a different request.",
  ],
  UNAVAILABLE: [
    503,
    "Service Unavailable",
    "The service is temporarily unavailable.",
  ],
};

/** Carries an expected refusal across the transaction boundary. */
export class Refusal extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly subject: { type: string; id: string } | null,
    detail?: string,
    readonly domainCode?: string,
  ) {
    super(detail ?? problems[code][2]);
    this.name = "Refusal";
  }
}

/** Produces the closed RFC 9457 problem contract without internal error details. */
export function problemResponse(
  code: ProblemCode,
  detail?: string,
  domainCode?: string,
): Response {
  const [status, title, fallback] = problems[code];
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title,
      status,
      detail: detail ?? fallback,
      code,
      ...(domainCode === undefined ? {} : { domainCode }),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/problem+json",
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Refuses a stale write before the command mutates a versioned record. */
export function expectVersion(
  actual: number,
  expected: number,
  subject: { type: string; id: string },
): void {
  if (actual !== expected) throw new Refusal("STALE_VERSION", subject);
}
