import "../polyfills";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { PortalHost } from "@rn-primitives/portal";
import { ThemeProvider } from "@/theme/theme-provider";
import { resolveMobileRole } from "@/features/auth/role";
import { useSession, SessionProvider } from "@/features/auth/session-provider";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { mobileFonts } from "@/theme/fonts";
import "../../global.css";
import { CaptureProvider } from "@/features/capture/capture-provider";
import { SessionQueryProvider } from "@/features/query/query-provider";
void SplashScreen.preventAutoHideAsync();
/** Keeps native startup visible until the original font assets are ready. */
export default function RootLayout(): ReactNode {
  const [ready, error] = useFonts(mobileFonts);

  if (error) throw error;
  if (!ready) return null;
  return (
    <LocaleProvider>
      <ThemeProvider>
        <SessionProvider>
          <CaptureProvider>
            <SessionQueryProvider>
              <SessionNavigator />
            </SessionQueryProvider>
          </CaptureProvider>
        </SessionProvider>
        <PortalHost />
      </ThemeProvider>
    </LocaleProvider>
  );
}

/** Guards shape navigation only; each API request still needs server authorisation. */
export function SessionNavigator(): ReactNode {
  const { state } = useSession();
  const signedIn = state.status === "signed_in";
  const context = signedIn
    ? state.contexts.find((item) => item.companyId === state.activeCompanyId)
    : undefined;
  const role = resolveMobileRole(context?.capacities ?? []);
  useEffect(() => {
    if (state.status !== "restoring") void SplashScreen.hideAsync();
  }, [state.status]);
  if (state.status === "restoring") return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="account" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && __DEV__}>
        <Stack.Screen name="gallery" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === null}>
        <Stack.Screen name="no-mobile-role" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === "manager"}>
        <Stack.Screen name="(manager)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === "owner"}>
        <Stack.Screen name="(owner)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === "tenant"}>
        <Stack.Screen name="(tenant)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === "technician"}>
        <Stack.Screen name="(technician)" />
      </Stack.Protected>
    </Stack>
  );
}
