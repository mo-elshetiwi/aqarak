/** Requires a valid scoring input and reports an explicit range error otherwise. */
export function requireValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (condition) return;
  throw new RangeError(message);
}
