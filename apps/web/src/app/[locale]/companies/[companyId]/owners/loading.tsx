import type { ReactElement } from "react";
import { EstateLoading } from "@/features/estate/components/loading";
function Loading(): ReactElement {
  return <EstateLoading geometry="owners" />;
}
export { Loading as default };
