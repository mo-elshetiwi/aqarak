import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/features/auth/session-provider";
import { CaptureStorage } from "./storage";
const Context = createContext<CaptureStorage | null>(null);
/** Storage survives navigation and drains copies before sign-out and company changes complete. */
export function CaptureProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { state } = useSession();
  const [storage] = useState(() => new CaptureStorage());
  const [failure, setFailure] = useState(false);
  const scope =
    state.status === "signed_in" && state.activeCompanyId
      ? `${state.account.id}:${state.activeCompanyId}`
      : null;
  useEffect(() => storage.bind(), [storage]);
  useEffect(() => {
    void storage.activate(scope).catch(() => {
      setFailure(true);
    });
  }, [scope, storage]);
  if (failure) throw new Error("Private capture storage could not be cleared");
  return <Context.Provider value={storage}>{children}</Context.Provider>;
}
/** Capture controls share one owner and cannot use storage outside the signed-in context. */
export function useCaptureStorage(): CaptureStorage {
  const storage = useContext(Context);
  const { state } = useSession();
  if (!storage || state.status !== "signed_in" || !state.activeCompanyId)
    throw new Error("An active capture context is required");
  return storage;
}
