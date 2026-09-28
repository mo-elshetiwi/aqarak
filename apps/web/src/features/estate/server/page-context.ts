import { isLocale, type Locale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import type { CompanyContext } from "@/lib/api/contract";
export interface EstatePageParams {
  locale: string;
  companyId: string;
  ownerId?: string;
  propertyId?: string;
}
export interface EstatePageContext {
  locale: Locale;
  companyId: string;
  context: CompanyContext;
  manager: boolean;
  permitted: boolean;
  sessionId: string;
}
export async function estatePageContext(
  params: EstatePageParams,
  allowOwner: false | "owner" | "property" = false,
): Promise<EstatePageContext> {
  if (!isLocale(params.locale)) notFound();
  const context = await requireCompanyContext(params.locale, params.companyId);
  const manager = context.staffRoles.includes("manager");
  const permitted =
    manager ||
    (allowOwner &&
      context.partyLinks.some(
        (link) =>
          link.role === "owner" &&
          (allowOwner === "property" || link.partyId === params.ownerId),
      ));
  const session = permitted ? await getCurrentSession() : null;
  return {
    locale: params.locale,
    companyId: params.companyId,
    context,
    manager,
    permitted,
    sessionId: session?.sessionId ?? "",
  };
}
