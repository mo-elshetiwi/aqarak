import "server-only";
import { isLocale, type Locale } from "@aqarak/i18n";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import type { CompanyContext } from "@/lib/api/contract";
import type { CurrentSession } from "@/lib/session/session";
import { getContractsApi, type ContractsApi } from "./contracts-api";
export interface RouteParams {
  locale: string;
  companyId: string;
  contractId?: string;
}
export async function pageContext(params: Promise<RouteParams>): Promise<{
  locale: Locale;
  companyId: string;
  contractId: string | undefined;
  company: CompanyContext;
  session: CurrentSession;
  t: Awaited<ReturnType<typeof getTranslations<"Contracts">>>;
  api: ContractsApi;
}> {
  const route = await params;
  if (!isLocale(route.locale)) notFound();
  const locale = route.locale;
  const company = await requireCompanyContext(locale, route.companyId);
  const session = await getCurrentSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const t = await getTranslations({ locale, namespace: "Contracts" });
  return {
    locale,
    companyId: route.companyId,
    contractId: route.contractId,
    company,
    session,
    t,
    api: getContractsApi(),
  };
}
