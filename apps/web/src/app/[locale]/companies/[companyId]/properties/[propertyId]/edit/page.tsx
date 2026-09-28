import { idSchema } from "@/features/estate/contract";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { PropertyEditForm } from "@/features/estate/components/property-edit";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
export default async function PropertyEditPage({
  params,
}: {
  params: Promise<EstatePageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const resolved = await params;
  const page = await estatePageContext(resolved, false);
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
    <PropertyEditForm companyId={page.companyId} property={result.value} />
  ) : (
    <EstateError namespace="Properties" problem={result.error} />
  );
}
