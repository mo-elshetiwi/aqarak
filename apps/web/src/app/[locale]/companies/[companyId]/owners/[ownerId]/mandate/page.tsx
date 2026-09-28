import { idSchema } from "@/features/estate/contract";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { getEstateApi } from "@/features/estate/server/estate-api";
import { MandateForm } from "@/features/estate/components/mandate-form";
import { EstateError, EstateDenied } from "@/features/estate/components/shared";
export default async function OwnerPage({
  params,
}: {
  params: Promise<EstatePageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const resolved = await params;
  const page = await estatePageContext(resolved, false);
  if (!page.permitted) return <EstateDenied namespace="Owners" />;
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
  return result.ok ? (
    <MandateForm companyId={page.companyId} owner={result.value} />
  ) : (
    <EstateError problem={result.error} />
  );
}
