import { idSchema } from "@/features/estate/contract";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
import { UnitsForm } from "@/features/estate/components/units";
export default async function NewUnitsPage({
  params,
}: {
  params: Promise<EstatePageParams>;
}): Promise<ReactElement> {
  const resolved = await params;
  const page = await estatePageContext(resolved);
  if (!page.permitted) return <EstateDenied namespace="Properties" />;
  if (!resolved.propertyId || !idSchema.safeParse(resolved.propertyId).success)
    return (
      <EstateError
        namespace="Properties"
        problem={{ code: "NOT_FOUND", status: 404 }}
      />
    );
  const result = await getEstateApi().getProperty(
    page.sessionId,
    page.companyId,
    {},
    [resolved.propertyId],
  );
  return result.ok ? (
    <UnitsForm companyId={page.companyId} propertyId={result.value.id} />
  ) : (
    <EstateError problem={result.error} namespace="Properties" />
  );
}
