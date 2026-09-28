import { cursorHistory } from "@/features/estate/pagination";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { ownerQuerySchema } from "@/features/estate/contract";
import { OwnersList } from "@/features/estate/components/owners-list";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
export const dynamic = "force-dynamic";
export default async function OwnersPage({
  params,
  searchParams,
}: {
  params: Promise<EstatePageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const page = await estatePageContext(await params);
  if (!page.permitted) return <EstateDenied namespace="Owners" />;
  const search = await searchParams;
  const parsed = ownerQuerySchema.safeParse(
    Object.fromEntries(Object.entries(search).filter(([, v]) => v !== "")),
  );
  const query = parsed.success ? parsed.data : {};
  const result = await getEstateApi().listOwners(
    page.sessionId,
    page.companyId,
    query,
  );
  return result.ok ? (
    <OwnersList
      companyId={page.companyId}
      query={query}
      previous={cursorHistory(search.previous)}
      {...result.value}
    />
  ) : (
    <EstateError problem={result.error} />
  );
}
