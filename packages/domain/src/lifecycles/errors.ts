import { z } from "zod";
import { coreErrorCode, type DomainError } from "../errors";

/** Lists lifecycle-specific refusals and the recorded reason for base version expiry. */
export const lifecyclesErrorCode = z.enum([
  "ACTIVE_MEMBERSHIP_EXISTS",
  "INVITATION_EXPIRED",
  "INVITATION_EMAIL_MISMATCH",
  "NOT_DRAFTED_FOR_ACTOR",
  "BASE_VERSION_CHANGED",
  "PERSON_REQUIRED",
]);
/** Combines shared and lifecycle refusals for transition callers. */
export const lifecycleRefusalCode = z.enum([
  ...coreErrorCode.options,
  ...lifecyclesErrorCode.options,
]);
/** Describes a typed lifecycle refusal. */
export type LifecycleError = DomainError<z.infer<typeof lifecycleRefusalCode>>;
