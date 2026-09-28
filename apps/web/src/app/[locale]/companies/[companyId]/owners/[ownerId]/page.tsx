import { idSchema } from "@/features/estate/contract";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { OwnerRecord } from "@/features/estate/components/owner-record";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
export default async function OwnerPage({
  params,
  searchParams,
}: {
  params: Promise<EstatePageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const resolved = await params;
  const page = await estatePageContext(resolved, "owner");
  if (!page.permitted)
    return page.context.partyLinks.some((link) => link.role === "owner") ? (
      <EstateError problem={{ code: "NOT_FOUND", status: 404 }} />
    ) : (
      <EstateDenied namespace="Owners" />
    );
  if (!resolved.ownerId || !idSchema.safeParse(resolved.ownerId).success)
    return (
      <EstateError
        namespace="Owners"
        problem={{ code: "NOT_FOUND", status: 404 }}
      />
    );
  const result = await getEstateApi().getOwner(
    page.sessionId,
    page.companyId,
    {},
    [resolved.ownerId],
  );
  const search = await searchParams;
  if (!result.ok) return <EstateError problem={result.error} />;
  const propertyResults = await Promise.all(
    result.value.properties.map((property) =>
      getEstateApi().getProperty(page.sessionId, page.companyId, {}, [
        property.id,
      ]),
    ),
  );
  const propertyRecords = propertyResults.flatMap((property) =>
    property.ok
      ? [page.manager ? property.value : { ...property.value, history: [] }]
      : [],
  );
  return (
    <OwnerRecord
      companyId={page.companyId}
      owner={page.manager ? result.value : { ...result.value, history: [] }}
      manager={page.manager}
      saved={
        search.saved === "bank" || search.saved === "owner"
          ? search.saved
          : search.saved === "mandate"
      }
      propertyRecords={propertyRecords}
    />
  );
}
