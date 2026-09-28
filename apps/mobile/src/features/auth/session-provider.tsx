import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { createAuthClient, type AuthClient } from "./auth-client";
import type { Credentials } from "./contract";
import { config } from "@/config";
import type { SessionState } from "./session";
import { SessionController, type SessionOptions } from "./session-controller";
import { createAuthorisedFetch } from "./authorised-fetch";
import { createTokenStore, type TokenStore } from "./token-store";
import { useLocale } from "@/features/locale/locale-provider";
interface SessionValue {
  state: SessionState;
  signIn: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
  retryRestore: () => Promise<void>;
  authorisedFetch: typeof fetch;
  switchContext: (companyId: string) => Promise<void>;
}
const Context = createContext<SessionValue | null>(null);
/** The controller owns credentials while React observes only safe session state. */
export function SessionProvider({
  children,
  client: provided,
  store,
  clock,
  schedule,
}: {
  children: ReactNode;
  client?: AuthClient;
  store?: TokenStore;
  clock?: SessionOptions["clock"];
  schedule?: SessionOptions["schedule"];
}): ReactNode {
  const { locale } = useLocale();
  const [controller] = useState(
    () =>
      new SessionController({
        client:
          provided ??
          createAuthClient(config, {
            clock: clock ?? Date.now,
            locale: () => locale,
          }),
        store: store ?? createTokenStore(),
        ...(clock ? { clock } : {}),
        ...(schedule ? { schedule } : {}),
      }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    const stop = controller.startRenewal();
    void controller.restore();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && controller.getSnapshot().status === "signed_in")
        void controller.renew().catch(() => undefined);
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [controller]);
  const [authorisedFetch] = useState(() => createAuthorisedFetch(controller));
  return (
    <Context.Provider
      value={{
        state,
        signIn: controller.signIn,
        signOut: controller.signOut,
        retryRestore: controller.restore,
        authorisedFetch,
        switchContext: controller.switchContext,
      }}
    >
      {children}
    </Context.Provider>
  );
}
/** Session access requires the shared boundary provider. */
export function useSession(): SessionValue {
  const session = useContext(Context);
  if (!session) throw new Error("SessionProvider is required");
  return session;
}
