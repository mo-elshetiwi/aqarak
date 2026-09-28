import type { DomainError } from "./errors";

/** Outcome of an operation whose refusal is an expected business result. */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
/** Wraps a successful value for callers that handle both outcomes. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
/** Wraps an expected refusal for callers that handle both outcomes. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
