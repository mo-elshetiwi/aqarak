/** Identify a candidate reference absent from the registry. */
export class UnknownCandidateError extends Error {
  constructor(cause?: unknown) {
    super("Unknown candidate", { cause });
    this.name = "UnknownCandidateError";
  }
}
/** Identify a provider without an installed adapter. */
export class AdapterNotAvailableError extends Error {
  constructor(cause?: unknown) {
    super("Adapter unavailable", { cause });
    this.name = "AdapterNotAvailableError";
  }
}
/** Represent a transport failure without exposing request or response content. */
export class ProviderUnavailableError extends Error {
  readonly transportRetries: number;
  readonly status: number | null;
  constructor(
    options: {
      readonly cause?: unknown;
      readonly status?: number;
      readonly transportRetries?: number;
    } = {},
  ) {
    super("ProviderUnavailableError", { cause: options.cause });
    this.name = "ProviderUnavailableError";
    this.status = options.status ?? null;
    this.transportRetries = options.transportRetries ?? 0;
  }
}
/** Represent a rejected or malformed provider response without exposing content. */
export class ProviderResponseError extends Error {
  readonly transportRetries: number;
  readonly status: number | null;
  constructor(
    options: {
      readonly cause?: unknown;
      readonly status?: number;
      readonly transportRetries?: number;
    } = {},
  ) {
    super("ProviderResponseError", { cause: options.cause });
    this.name = "ProviderResponseError";
    this.status = options.status ?? null;
    this.transportRetries = options.transportRetries ?? 0;
  }
}
/** Prevent evaluation against unexpected local weights. */
export class DigestMismatchError extends Error {
  constructor(cause?: unknown) {
    super("Local weights digest mismatch", { cause });
    this.name = "DigestMismatchError";
  }
}
