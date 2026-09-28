import type { ReactElement } from "react";
import { EstateLoading } from "@/features/estate/components/loading";
function Loading(): ReactElement {
  return <EstateLoading geometry="properties" />;
}
export { Loading as default };
