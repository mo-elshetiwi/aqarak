import { EstateDenied } from "@/features/estate/components/shared";
import type { ReactElement } from "react";
import {
  estatePageContext,
  type EstatePageParams,
} from "@/features/estate/server/page-context";
import { OwnerForm } from "@/features/estate/components/owner-form";
export default async function NewOwnerPage({
  params,
}: {
  params: Promise<EstatePageParams>;
}): Promise<ReactElement> {
  const page = await estatePageContext(await params);
  if (!page.permitted) return <EstateDenied namespace="Owners" />;
  return (
    <OwnerForm
      companyId={page.companyId}
      selfManagedAllowed={page.context.companyKind === "self_managed_owner"}
    />
  );
}
