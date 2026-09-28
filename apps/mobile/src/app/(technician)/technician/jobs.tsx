import type { ReactNode } from "react";
import { TabScreen } from "@/components/shell/tab-screen";
/** Describes the content intended for this mobile route. */
export default function Screen(): ReactNode {
  return <TabScreen name="jobs" />;
}
