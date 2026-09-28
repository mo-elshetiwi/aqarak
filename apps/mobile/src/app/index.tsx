import type { ReactNode } from "react";
import { Redirect } from "expo-router";
import { useSession } from "@/features/auth/session-provider";
import { resolveMobileRole, roleHome } from "@/features/auth/role";
/** The active context determines the first permitted mobile destination. */
export default function Index(): ReactNode {
  const { state } = useSession();
  if (state.status === "restoring") return null;
  if (state.status !== "signed_in") return <Redirect href="/sign-in" />;
  const context = state.contexts.find(
    (item) => item.companyId === state.activeCompanyId,
  );
  return (
    <Redirect href={roleHome(resolveMobileRole(context?.capacities ?? []))} />
  );
}
