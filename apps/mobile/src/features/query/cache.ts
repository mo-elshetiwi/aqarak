import { QueryClient } from "@tanstack/react-query";
import type { SessionState } from "@/features/auth/session";
import { AuthError } from "@/features/auth/auth-client";
import { registerSignOutTask, subscribe } from "@/features/auth/session-events";

/** Status-only failures avoid retaining response bodies in the cache. */
export class QueryHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${String(status)}`);
    this.name = "QueryHttpError";
  }
}
/** Every server key starts with the active account and company. Missing context is a programming error. */
export function companyQueryKey(
  state: SessionState,
  parts: readonly unknown[],
): readonly unknown[] {
  if (
    state.status !== "signed_in" ||
    !state.activeCompanyId ||
    !state.contexts.some(
      (context) => context.companyId === state.activeCompanyId,
    )
  )
    throw new Error("An active account and company context is required");
  return [state.account.id, state.activeCompanyId, ...parts];
}
/** Only transport and server failures receive at most two retries. */
export function retryQuery(failureCount: number, error: Error): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof QueryHttpError)
    return error.status >= 500 && error.status <= 599;
  if (error instanceof AuthError)
    return (
      error.code === "network_unavailable" ||
      error.code === "service_unavailable"
    );
  return error instanceof TypeError;
}
/** Query data has no disk persistence: nothing from an earlier account or company survives on a shared device. */
export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 30 * 60_000,
        retry: retryQuery,
        networkMode: "online",
      },
      mutations: { retry: false, networkMode: "online" },
    },
  });
}
/** Clear before a new identity boundary is published, including in-flight query cancellation. */
export function bindSessionCache(client: QueryClient): () => void {
  const clear = (): void => {
    client.clear();
  };
  const remove = [
    subscribe("signed_out", clear),
    subscribe("context_changed", clear),
    registerSignOutTask(clear),
  ];
  return () => {
    remove.forEach((stop) => {
      stop();
    });
    clear();
  };
}
