import { useEffect, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-provider";
import {
  bindSessionCache,
  companyQueryKey,
  createSessionQueryClient,
  QueryHttpError,
} from "./cache";
import { OfflineBanner } from "./connectivity";

/** Native connectivity and foreground state control query scheduling. */
export function bindQueryLifecycle(): () => void {
  const stopNetwork = NetInfo.addEventListener((state) => {
    onlineManager.setOnline(
      state.isConnected === true && state.isInternetReachable !== false,
    );
  });
  focusManager.setFocused(AppState.currentState === "active");
  const subscription = AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
  });
  return () => {
    stopNetwork();
    subscription.remove();
  };
}
function SignedInQueries({ children }: { children: ReactNode }): ReactNode {
  const [client] = useState(createSessionQueryClient);
  const { state } = useSession();
  useEffect(() => bindSessionCache(client), [client]);
  useEffect(bindQueryLifecycle, []);
  return (
    <QueryClientProvider client={client}>
      <View className="flex-1">
        <OfflineBanner />
        <View
          key={state.status === "signed_in" ? state.activeCompanyId : ""}
          className="flex-1"
        >
          {children}
        </View>
      </View>
    </QueryClientProvider>
  );
}
/** Exactly one memory cache is created for each signed-in session, below SessionProvider. */
export function SessionQueryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { state } = useSession();
  return state.status === "signed_in" ? (
    <SignedInQueries key={state.account.id}>{children}</SignedInQueries>
  ) : (
    children
  );
}
/** Fetchers receive only the authorised transport and a cancellation signal; scope and retry policy cannot be overridden. */
export function useCompanyQuery<T>(
  parts: readonly unknown[],
  fetcher: (transport: typeof fetch, signal: AbortSignal) => Promise<T>,
  options?: Omit<
    UseQueryOptions<T>,
    "queryKey" | "queryFn" | "retry" | "networkMode" | "gcTime"
  >,
): UseQueryResult<T> {
  const { state, authorisedFetch } = useSession();
  const queryKey = companyQueryKey(state, parts);
  return useQuery({
    ...options,
    queryKey,
    queryFn: ({ signal }) =>
      fetcher(async (input, init) => {
        const response = await authorisedFetch(input, { ...init, signal });
        if (!response.ok) throw new QueryHttpError(response.status);
        return response;
      }, signal),
  });
}
