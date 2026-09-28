import type { ReactElement } from "react";
import { TenantSkeleton } from "@/app/[locale]/companies/[companyId]/tenants/_components/tenant-skeleton";
function Loading(): ReactElement {
  return <TenantSkeleton layout="new" />;
}
export { Loading as default };
