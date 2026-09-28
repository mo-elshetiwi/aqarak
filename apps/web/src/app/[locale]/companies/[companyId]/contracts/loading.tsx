import type { ReactElement } from "react";
import { TableSkeleton } from "@/components/system/screen-states";
function Loading(): ReactElement {
  return <TableSkeleton />;
}
export { Loading as default };
