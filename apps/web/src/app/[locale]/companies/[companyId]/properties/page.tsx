import { cursorHistory } from "@/features/estate/pagination";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
import { propertyQuerySchema } from "@/features/estate/contract";
import { PropertiesList } from "@/features/estate/components/properties-list";
export const dynamic = "force-dynamic";
export default async function PropertiesPage({
  params,
  searchParams,
}: {
  params: Promise<EstatePageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const page = await estatePageContext(await params);
  if (!page.permitted) return <EstateDenied namespace="Properties" />;
  const search = await searchParams;
  const parsed = propertyQuerySchema.safeParse(search);
  const query = parsed.success ? parsed.data : {};
  const result = await getEstateApi().listProperties(
    page.sessionId,
    page.companyId,
    query,
  );
  return result.ok ? (
    <PropertiesList
      companyId={page.companyId}
      query={query}
      previous={cursorHistory(search.previous)}
      {...result.value}
    />
  ) : (
    <EstateError problem={result.error} namespace="Properties" />
  );
}
