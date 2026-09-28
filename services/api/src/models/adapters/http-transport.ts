import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { ProviderResponseError, ProviderUnavailableError } from "../errors";

export interface HttpOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value !== null) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}
/** Retry transient HTTP failures while discarding provider error bodies. */
export async function postWithRetries(
  options: HttpOptions,
  path: string,
  init: RequestInit & { readonly signal: AbortSignal },
): Promise<{ readonly response: Response; readonly transportRetries: number }> {
  const sleep =
    options.sleep ??
    (async (milliseconds: number, signal: AbortSignal): Promise<void> => {
      await setTimeout(milliseconds, undefined, { signal });
    });
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await options.fetch(
        `${options.baseUrl.replace(/\/$/, "")}${path}`,
        {
          ...init,
          method: "POST",
          headers: authenticatedHeaders(init.headers, options.apiKey),
        },
      );
    } catch (cause) {
      throw new ProviderUnavailableError({ cause, transportRetries: attempt });
    }
    if (response.ok) return { response, transportRetries: attempt };
    if (response.status !== 429 && response.status < 500)
      throw new ProviderResponseError({
        status: response.status,
        transportRetries: attempt,
      });
    if (attempt === 2)
      throw new ProviderUnavailableError({
        status: response.status,
        transportRetries: attempt,
      });
    const delay = retryDelay(response, attempt);
    await response.body?.cancel();
    try {
      await sleep(delay, init.signal);
    } catch (cause) {
      throw new ProviderUnavailableError({ cause, transportRetries: attempt });
    }
  }
  throw new ProviderUnavailableError();
}
/** Parse provider JSON without retaining invalid response text in errors. */
export async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  transportRetries: number,
): Promise<T> {
  try {
    const parsed = schema.safeParse(await response.json());
    if (parsed.success) return parsed.data;
  } catch {
    throw new ProviderResponseError({ transportRetries });
  }
  throw new ProviderResponseError({ transportRetries });
}

function authenticatedHeaders(
  input: HeadersInit | undefined,
  key: string,
): Headers {
  const headers = new Headers(input);
  headers.set("Authorization", `Bearer ${key}`);
  return headers;
}
