import { z } from "zod";
import { AuthError, type AuthClient } from "./auth-client";
import {
  credentialsSchema,
  signInSchema,
  refreshSchema,
  meSchema,
  signOutSchema,
} from "./contract";
interface RequestOptions<T> {
  method: "GET" | "POST";
  schema: z.ZodType<T>;
  accessToken?: string;
  body?: unknown;
  empty?: boolean;
}
function responseFailure(response: Response, path: string): AuthError {
  if (response.status === 429) return new AuthError("too_many_attempts");
  if (response.status >= 500) return new AuthError("service_unavailable");
  if (response.status >= 400 && response.status < 500)
    return new AuthError(
      path === "/v1/auth/sign-in" ? "invalid_credentials" : "session_ended",
    );
  return new AuthError("service_unavailable");
}
/** An injected fetch keeps the contract independent of a deployed service. */
export function createHttpAuthClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
): AuthClient {
  const base = baseUrl.replace(/\/$/, "");
  async function request<T>(
    path: string,
    options: RequestOptions<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AuthError("network_unavailable"));
      }, 15_000);
    });
    async function perform(): Promise<T> {
      const headers: Record<string, string> = {
        Accept: "application/json, application/problem+json",
      };
      if (options.body !== undefined)
        headers["Content-Type"] = "application/json";
      if (options.accessToken)
        headers.Authorization = `Bearer ${options.accessToken}`;
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method: options.method,
          headers,
          signal: controller.signal,
          ...(options.body !== undefined
            ? { body: JSON.stringify(options.body) }
            : {}),
        });
      } catch {
        throw new AuthError("network_unavailable");
      }
      if (!response.ok) throw responseFailure(response, path);
      let body: unknown;
      try {
        body =
          options.empty && response.status === 204
            ? await response.text()
            : await response.json();
      } catch {
        throw new AuthError("unexpected_response");
      }
      if (response.status !== (options.empty ? 204 : 200))
        throw new AuthError("unexpected_response");
      const parsed = options.schema.safeParse(body);
      if (!parsed.success) throw new AuthError("unexpected_response");
      return parsed.data;
    }
    try {
      return await Promise.race([perform(), expired]);
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    signIn(credentials) {
      const parsed = credentialsSchema.safeParse(credentials);
      if (!parsed.success)
        return Promise.reject(new AuthError("invalid_credentials"));
      return request("/v1/auth/sign-in", {
        method: "POST",
        schema: signInSchema,
        body: { ...parsed.data, client: "mobile" },
      });
    },
    refresh(refreshToken) {
      return request("/v1/auth/refresh", {
        method: "POST",
        schema: refreshSchema,
        body: { refreshToken, client: "mobile" },
      });
    },
    signOut(accessToken, refreshToken) {
      return request("/v1/auth/sign-out", {
        method: "POST",
        schema: signOutSchema,
        accessToken,
        body: { refreshToken },
        empty: true,
      });
    },
    getMe(accessToken) {
      return request("/v1/me", {
        method: "GET",
        schema: meSchema,
        accessToken,
      });
    },
  };
}
