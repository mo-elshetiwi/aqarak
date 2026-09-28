import type { ReactNode } from "react";
import { RoleTabs } from "@/components/shell/role-tabs";
/** Uses the shared fixed tab sequence for this role. */
export default function TabsLayout(): ReactNode {
  return <RoleTabs role="tenant" />;
}
