import { z } from "zod";
import { err, ok, type Result } from "../result";
import { encodeCanonical, sha256Hex, type CanonicalValue } from "../audit";

/** Validates a client key scoped by company, account and command type for each tap. */
export const idempotencyKey = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .brand<"IdempotencyKey">();

/** Describes a validated client key used within its company, account and command scope. */
export type IdempotencyKey = z.infer<typeof idempotencyKey>;

/** Defines how many days a completed request remains eligible for replay. */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

/** Identifies expected refusals when a client reuses a key for a different request. */
export const idempotencyErrorCode = z.enum(["IDEMPOTENCY_KEY_REUSED"]);

/** Validates a refusal before mapping it to the API response. */
export const idempotencyError = z
  .strictObject({ code: idempotencyErrorCode, field: z.string().optional() })
  .readonly();

/** Describes an expected idempotency refusal for API error mapping. */
export type IdempotencyError = z.infer<typeof idempotencyError>;

const canonicalValue: z.ZodType<CanonicalValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(canonicalValue).readonly(),
    z.record(z.string(), canonicalValue).readonly(),
  ]),
);
/** Validates the stored attempt shape when loading scoped replay data. */
export const storedIdempotency = z
  .strictObject({
    request_sha256: z.string(),
    response: canonicalValue.nullable(),
    created_at: z.string(),
  })
  .readonly();
/** Validates an execution or replay decision when crossing a boundary. */
export const idempotencyDecision = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("proceed") }).readonly(),
  z
    .strictObject({ kind: z.literal("replay"), response: canonicalValue })
    .readonly(),
]);

/** Describes a stored attempt within the scope (company_id, account_id, command_type, key). */
export type StoredIdempotency = z.infer<typeof storedIdempotency>;

/** Describes whether to execute a command or replay its completed response. */
export type IdempotencyDecision = z.infer<typeof idempotencyDecision>;

const utcInstant = z.iso.datetime().regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);

function instantMicroseconds(value: string): bigint {
  if (!utcInstant.safeParse(value).success) {
    throw new TypeError(
      "Idempotency time must be a UTC instant with at most six fractional digits",
    );
  }
  const [seconds = "", fraction = ""] = value.slice(0, -1).split(".");
  return (
    BigInt(Date.parse(`${seconds}Z`)) * 1000n + BigInt(fraction.padEnd(6, "0"))
  );
}

/** Derives a request identity from canonical path parameters and a body, using null for no body.
 * Numeric 1 and the string "1" encode identically by design; callers validate types first.
 * @throws {TypeError} If canonical keys, strings or values are malformed.
 * @throws {RangeError} If numbers are non-finite or unsafe integers.
 */
export function requestSha256(input: {
  readonly pathParams: Readonly<Record<string, string>>;
  readonly body: CanonicalValue;
}): string {
  return sha256Hex(
    encodeCanonical({ body: input.body, path: input.pathParams }),
  );
}

/** Decides replay within (company_id, account_id, command_type, key), expiring only after seven days.
 * @throws {TypeError} If request hashes or UTC instants are malformed.
 */
export function decideIdempotency(input: {
  readonly stored: StoredIdempotency | null;
  readonly requestSha256: string;
  readonly now: string;
}): Result<IdempotencyDecision, IdempotencyError> {
  const now = instantMicroseconds(input.now);
  if (!digest.safeParse(input.requestSha256).success) {
    throw new TypeError(
      "Request hash must contain 64 lowercase hex characters",
    );
  }
  if (input.stored === null) return ok({ kind: "proceed" });
  const stored = input.stored;
  const created = instantMicroseconds(stored.created_at);
  if (!digest.safeParse(stored.request_sha256).success) {
    throw new TypeError("Stored request hash is invalid");
  }
  const retention = BigInt(IDEMPOTENCY_RETENTION_DAYS) * 86400n * 1000000n;
  if (now - created > retention || stored.response === null) {
    return ok({ kind: "proceed" });
  }
  if (stored.request_sha256 !== input.requestSha256) {
    return err({ code: "IDEMPOTENCY_KEY_REUSED" });
  }
  return ok({ kind: "replay", response: stored.response });
}

/** Builds a reminder identity from a rule, subject and caller-supplied Asia/Dubai calendar date.
 * @throws {TypeError} If the rule, subject identifier or calendar date is malformed.
 */
export function firingDedupeKey(input: {
  readonly ruleCode: string;
  readonly subjectId: string;
  readonly fireOn: string;
}): string {
  if (
    !/^n([1-9]|1[0-3])$/.test(input.ruleCode) ||
    !z.iso.date().safeParse(input.fireOn).success ||
    input.subjectId.length === 0 ||
    input.subjectId.includes(":") ||
    !input.subjectId.isWellFormed()
  ) {
    throw new TypeError(
      "Invalid reminder rule, subject identifier or calendar date",
    );
  }
  return `${input.ruleCode}:${input.subjectId}:${input.fireOn}`;
}
