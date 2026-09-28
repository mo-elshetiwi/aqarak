import { act, render, screen } from "@testing-library/react-native";
import {
  QueryClientProvider,
  onlineManager,
  focusManager,
} from "@tanstack/react-query";
import NetInfo, { NetInfoStateType } from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { createFixtureAuthClient } from "@/features/auth/fixture-auth-client";
import { emitSessionEvent } from "@/features/auth/session-events";
import { AuthError } from "@/features/auth/auth-client";
import { Text } from "@/components/ui/text";
import type { SessionState } from "@/features/auth/session";
import { useSession } from "@/features/auth/session-provider";
import {
  bindSessionCache,
  companyQueryKey,
  createSessionQueryClient,
  QueryHttpError,
  retryQuery,
} from "./cache";
import { OfflineBanner, useOnlineRequirement } from "./connectivity";
import { bindQueryLifecycle, useCompanyQuery } from "./query-provider";
jest.mock("@/features/auth/session-provider", () => ({
  useSession: jest.fn(),
}));
async function signedIn(): Promise<SessionState> {
  const fixture = createFixtureAuthClient();
  const tokens = await fixture.signIn({
    username: "multi-1",
    password: "synthetic",
  });
  const me = await fixture.getMe(tokens.accessToken);
  return {
    status: "signed_in",
    ...me,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    activeCompanyId: me.contexts[0]?.companyId ?? null,
  };
}
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});
it("AC-1 keys begin with each account and company and missing context throws", async () => {
  const first = await signedIn();
  if (first.status !== "signed_in") throw new Error("Invalid fixture");
  const second = {
    ...first,
    account: { ...first.account, id: "another-account" },
    activeCompanyId: first.contexts[1]?.companyId ?? null,
  };
  expect(companyQueryKey(first, ["contracts"])).toEqual([
    first.account.id,
    first.activeCompanyId,
    "contracts",
  ]);
  expect(companyQueryKey(second, ["contracts"])).toEqual([
    second.account.id,
    second.activeCompanyId,
    "contracts",
  ]);
  expect(companyQueryKey(first, ["contracts"])).not.toEqual(
    companyQueryKey(second, ["contracts"]),
  );
  expect(() => companyQueryKey({ status: "signed_out" }, [])).toThrow(
    "context",
  );
  expect(() =>
    companyQueryKey({ ...first, activeCompanyId: null }, []),
  ).toThrow("context");
});
it.each(["signed_out", "context_changed"] as const)(
  "AC-1 %s empties the cache and cancels late writes",
  async (type) => {
    const client = createSessionQueryClient();
    const stop = bindSessionCache(client);
    client.setQueryData(["account", "company", "contracts"], ["synthetic"]);
    let finish: ((value: string) => void) | undefined;
    const request = client
      .query({
        queryKey: ["account", "company", "late"],
        queryFn: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => undefined);
    await emitSessionEvent({
      type,
      accountId: "account",
      previousCompanyId: "company",
      companyId: null,
    });
    finish?.("late");
    await request;
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    stop();
  },
);
it("only network or 5xx failures retry twice and 4xx never retry", () => {
  for (const status of [400, 401, 403, 404, 429])
    expect(retryQuery(0, new QueryHttpError(status))).toBe(false);
  for (const error of [
    new TypeError("network"),
    new QueryHttpError(503),
    new AuthError("network_unavailable"),
  ]) {
    expect(retryQuery(0, error)).toBe(true);
    expect(retryQuery(1, error)).toBe(true);
    expect(retryQuery(2, error)).toBe(false);
  }
  expect(retryQuery(0, new Error("schema"))).toBe(false);
});
function Requirement(): React.ReactNode {
  const { allowed, reason } = useOnlineRequirement();
  return <Text testID="requirement">{allowed ? "allowed" : reason}</Text>;
}
it.each(["en", "ar"] as const)(
  "AC-2 %s reports Dubai cache time and connection requirements",
  async (locale) => {
    const client = createSessionQueryClient();
    await render(
      <LocaleProvider initialLocale={locale}>
        <QueryClientProvider client={client}>
          <OfflineBanner />
          <Requirement />
        </QueryClientProvider>
      </LocaleProvider>,
    );
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    await act(() => {
      onlineManager.setOnline(false);
    });
    expect(
      screen.getByText(
        locale === "en" ? "You are offline." : "أنت غير متصل بالإنترنت.",
      ),
    ).toBeTruthy();
    await act(() => {
      client.setQueryData(["account", "company", "contracts"], [], {
        updatedAt: Date.parse("2026-09-28T06:42:00Z"),
      });
    });
    expect(
      screen.getByText(
        locale === "en"
          ? "You are offline. Showing data from 10:42."
          : "أنت غير متصل بالإنترنت. تُعرض بيانات آخر تحديث في 10:42.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("requirement")).toHaveTextContent(
      locale === "en"
        ? "You are offline. This needs a connection."
        : "أنت غير متصل بالإنترنت. يتطلب هذا الإجراء اتصالاً بالإنترنت.",
    );
    await act(() => {
      onlineManager.setOnline(true);
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    expect(screen.getByTestId("requirement")).toHaveTextContent("allowed");
    await screen.unmount();
    client.clear();
  },
);
it("native network and foreground events feed query managers and remove subscriptions", () => {
  const subscription = jest.spyOn(AppState, "addEventListener");
  const stop = bindQueryLifecycle();
  const listener = jest.mocked(NetInfo.addEventListener).mock.calls[0]?.[0];
  const snapshot = {
    type: NetInfoStateType.none,
    isConnected: false,
    isInternetReachable: false,
    details: null,
  } satisfies import("@react-native-community/netinfo").NetInfoState;
  listener?.(snapshot);
  expect(onlineManager.isOnline()).toBe(false);
  const foreground = subscription.mock.calls[0]?.[1];
  foreground?.("background");
  expect(focusManager.isFocused()).toBe(false);
  foreground?.("active");
  expect(focusManager.isFocused()).toBe(true);
  stop();
});
it("company queries use authorised fetch and keep cached data while offline", async () => {
  const state = await signedIn();
  const transport = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(new Response("[]"));
  jest.mocked(useSession).mockReturnValue({
    state,
    authorisedFetch: transport,
    signIn: jest.fn(),
    signOut: jest.fn(),
    retryRestore: jest.fn(),
    switchContext: jest.fn(),
  });
  const client = createSessionQueryClient();
  const fetcher = jest.fn(
    async (fetch: typeof globalThis.fetch, signal: AbortSignal) => {
      await fetch("https://example.test/contracts", { signal });
      return "loaded";
    },
  );
  function Data(): React.ReactNode {
    const query = useCompanyQuery(["contracts"], fetcher);
    return <Text>{query.data ?? "loading"}</Text>;
  }
  await render(
    <QueryClientProvider client={client}>
      <Data />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("loaded")).toBeTruthy();
  expect(transport).toHaveBeenCalledTimes(1);
  await act(() => {
    onlineManager.setOnline(false);
    void client.invalidateQueries();
  });
  expect(screen.getByText("loaded")).toBeTruthy();
  expect(transport).toHaveBeenCalledTimes(1);
  await screen.unmount();
  client.clear();
});
