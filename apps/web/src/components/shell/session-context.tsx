"use client";
import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
const CsrfContext = createContext<string | undefined>(undefined);
export function SessionProvider({
  csrfToken,
  children,
}: {
  csrfToken: string;
  children: ReactNode;
}): ReactElement {
  return (
    <CsrfContext.Provider value={csrfToken}>{children}</CsrfContext.Provider>
  );
}
export function useCsrfToken(): string | undefined {
  return useContext(CsrfContext);
}
