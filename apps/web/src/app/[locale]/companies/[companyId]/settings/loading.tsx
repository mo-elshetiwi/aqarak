import type { ReactElement } from "react";
import { PageSkeleton } from "@/components/system/screen-states";
function Loading(): ReactElement {
  return <PageSkeleton />;
}

export { Loading as default };
