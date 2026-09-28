import { z } from "zod";
import { err, ok, type Result } from "./result";

/** Describes a refusal callers must handle using each module's closed code list. */
export interface DomainError<Code extends string = string> {
  readonly code: Code;
  readonly field?: string;
}

/** Lists shared refusal codes for domain validation and concurrency checks. */
export const coreErrorCode = z.enum([
  "INVALID_TRANSITION",
  "VERSION_CONFLICT",
  "REASON_REQUIRED",
  "INVALID_INPUT",
]);
/** Represents a shared refusal code when handling a failed domain operation. */
export type CoreErrorCode = z.infer<typeof coreErrorCode>;

/** Creates a typed refusal when a domain operation cannot proceed. */
export function refuse<Code extends string>(
  code: Code,
  field?: string,
): Result<never, DomainError<Code>> {
  return err(field === undefined ? { code } : { code, field });
}

/** Validates and trims a mandatory explanation before a domain decision. */
export const reason = z.string().trim().min(1).max(1000).brand<"Reason">();
/** Represents a validated explanation for a domain decision requiring a reason. */
export type Reason = z.infer<typeof reason>;

/** Requires a valid explanation when a domain decision must record its reason. */
export function requireReason(
  value: string | null | undefined,
): Result<Reason, DomainError<"REASON_REQUIRED">> {
  const parsed = reason.safeParse(value);
  return parsed.success ? ok(parsed.data) : refuse("REASON_REQUIRED", "reason");
}

/** Checks an expected entity version before an optimistic concurrency update. */
export function checkExpectedVersion(
  current: number,
  expected: number,
): Result<void, DomainError<"VERSION_CONFLICT">> {
  return current === expected ? ok(undefined) : refuse("VERSION_CONFLICT");
}
