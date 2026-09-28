import { idSchema } from "@/features/estate/contract";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
import { PropertyRecord } from "@/features/estate/components/property-record";
import { propertyDocTypeSchema } from "@/features/estate/contract";
export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<EstatePageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const resolved = await params;
  const page = await estatePageContext(resolved, "property");
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
  if (
    result.ok &&
    !page.manager &&
    !result.value.owners.some((owner) =>
      page.context.partyLinks.some(
        (link) => link.role === "owner" && link.partyId === owner.id,
      ),
    )
  )
    return (
      <EstateError
        namespace="Properties"
        problem={{ code: "NOT_FOUND", status: 404 }}
      />
    );
  const search = await searchParams;
  const selected = propertyDocTypeSchema.safeParse(search.document);
  return result.ok ? (
    <PropertyRecord
      companyId={page.companyId}
      property={page.manager ? result.value : { ...result.value, history: [] }}
      manager={page.manager}
      saved={search.saved === "property"}
      initialDocument={
        page.manager && selected.success ? selected.data : undefined
      }
    />
  ) : (
    <EstateError problem={result.error} namespace="Properties" />
  );
}
