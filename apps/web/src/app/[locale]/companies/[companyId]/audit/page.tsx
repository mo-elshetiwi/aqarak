import type { ReactElement } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { PageHeader } from "@/components/system/page-header";
import { workflowIsMock } from "../tawtheeq/_lib/client";
import { canReadAudit, getAuditClient } from "./_lib/client";
import { eventFiltersSchema } from "./_lib/schemas";
import { tamperSyntheticChain } from "./_lib/mock-store";
import { AuditTrail } from "./_components/trail";
import {
  AuditError,
  AuditFailure,
  AuditNotPermitted,
} from "./_components/states";
export const dynamic = "force-dynamic";
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  if (!canReadAudit(context)) return <AuditNotPermitted />;
  const session = await getCurrentSession();
  if (!session) notFound();
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: "Audit" });
  const parsed = eventFiltersSchema.safeParse(query);
  if (!parsed.success)
    return (
      <>
        <PageHeader title={t("title")} />
        <AuditError code="VALIDATION_FAILED" />
      </>
    );
  const synthetic = workflowIsMock();
  if (synthetic && query.scenario === "tampered")
    tamperSyntheticChain(session.sessionId);
  const result = await getAuditClient(companyId, session.sessionId).events(
    parsed.data,
  );
  if (!result.ok)
    return result.error.status === 403 ? (
      <AuditNotPermitted />
    ) : (
      <>
        <PageHeader title={t("title")} />
        <AuditFailure />
      </>
    );
  return (
    <AuditTrail
      initial={result.value}
      initialFilters={parsed.data}
      companyId={companyId}
      locale={locale}
      synthetic={synthetic}
    />
  );
}
