import type { CompanyContext } from "@/lib/api/contract";
import type { TawtheeqRecord } from "../_lib/schemas";
import type { ReactElement } from "react";
import { isLocale, type Locale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { NotPermittedState } from "@/components/system/screen-states";
import { PageHeader } from "@/components/system/page-header";
import { getTawtheeqClient, workflowIsMock } from "../_lib/client";
import { canReadAudit, getAuditClient } from "../../audit/_lib/client";
import { subjectTypeSchema } from "../../audit/_lib/schemas";
import { AuditFailure } from "../../audit/_components/states";
import { HistoryScreen } from "../_components/history";
import { OwnerDecisionScreen } from "../_components/owner-decision";
import { RecordScreen } from "../_components/record";
import { LoadFailure } from "../_components/common";
export const dynamic = "force-dynamic";
export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; companyId: string; recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { locale, companyId, recordId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  const t = await getTranslations({ locale, namespace: "Tawtheeq" });
  const query = await searchParams;
  const session = await getCurrentSession();
  if (!session) notFound();
  if (query.tab === "history")
    return renderHistory({
      context,
      locale,
      companyId,
      recordId,
      query,
      sessionId: session.sessionId,
    });
  const manager = isSectionPermitted(context, "tawtheeq");
  const owner = context.partyLinks.some((link) => link.role === "owner");
  if (!manager && !owner)
    return (
      <>
        <PageHeader title={t("notPermitted")} />
        <NotPermittedState />
      </>
    );
  const client = getTawtheeqClient(companyId, session.sessionId, context);
  const response = await client.getRecord(recordId);
  if (!response.ok && response.error.status === 403)
    return (
      <>
        <PageHeader title={t("notPermitted")} />
        <NotPermittedState />
      </>
    );
  if (!response.ok)
    return (
      <>
        <PageHeader title={t("title")} />
        <LoadFailure />
      </>
    );
  if (!manager) {
    const record = response.value;
    if (!ownerMayDecide(context, record))
      return (
        <>
          <PageHeader title={t("notPermitted")} />
          <NotPermittedState />
        </>
      );
    return (
      <OwnerDecisionScreen
        initialRecord={record}
        companyId={companyId}
        locale={locale}
      />
    );
  }
  const source = response.value.document
    ? await client.getDocumentUrl(recordId)
    : null;
  return (
    <RecordScreen
      initialRecord={response.value}
      initialSource={source?.ok ? source.value : null}
      companyId={companyId}
      locale={locale}
      synthetic={workflowIsMock()}
    />
  );
}

function ownerMayDecide(
  context: CompanyContext,
  record: TawtheeqRecord,
): boolean {
  return (
    context.partyLinks.some(
      (link) =>
        link.role === "owner" && link.partyId === record.contract.owner.partyId,
    ) &&
    (record.workflowState === "awaiting_owner_reapproval" ||
      (record.workflowState === "awaiting_registration" &&
        Boolean(record.skipReason)))
  );
}

async function renderHistory({
  context,
  locale,
  companyId,
  recordId,
  query,
  sessionId,
}: {
  context: CompanyContext;
  locale: Locale;
  companyId: string;
  recordId: string;
  query: Record<string, string | string[] | undefined>;
  sessionId: string;
}): Promise<ReactElement> {
  const t = await getTranslations({ locale, namespace: "Tawtheeq" });
  if (!canReadAudit(context))
    return (
      <>
        <PageHeader title={t("history")} />
        <p className="rounded-md border bg-muted p-6">
          {t("historyNotPermitted")}
        </p>
      </>
    );
  const type = subjectTypeSchema.safeParse(
    query.subjectType ?? "tawtheeq_record",
  );
  const subjectId =
    typeof query.subjectId === "string" ? query.subjectId : recordId;
  if (!type.success) notFound();
  const result = await getAuditClient(companyId, sessionId).versions(
    type.data,
    subjectId,
  );
  if (!result.ok)
    return (
      <>
        <PageHeader title={t("history")} />
        <AuditFailure />
      </>
    );
  return (
    <HistoryScreen
      history={result.value}
      locale={locale}
      recordHref={`/${locale}/companies/${companyId}/tawtheeq/${recordId}`}
    />
  );
}
