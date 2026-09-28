import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
import { ownerOptions } from "@/features/estate/server/owner-options";
import { PropertyForm } from "@/features/estate/components/property-form";
export default async function NewPropertyPage({
  params,
}: {
  params: Promise<EstatePageParams>;
}): Promise<ReactElement> {
  const page = await estatePageContext(await params);
  if (!page.permitted) return <EstateDenied namespace="Properties" />;
  const owners = await ownerOptions(
    getEstateApi(),
    page.sessionId,
    page.companyId,
  );
  return owners.ok ? (
    <PropertyForm companyId={page.companyId} owners={owners.value} />
  ) : (
    <EstateError problem={owners.error} namespace="Properties" />
  );
}
