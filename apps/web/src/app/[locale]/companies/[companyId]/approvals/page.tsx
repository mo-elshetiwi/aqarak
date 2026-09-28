import type { Metadata } from "next";
import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { pageContext, type RouteParams } from "../contracts/_lib/page-context";
import { LoadProblem } from "../contracts/_components/load-problem";
import { ApprovalsQueue } from "./_components/approvals-queue";
export const dynamic = "force-dynamic";
interface Props {
  params: Promise<RouteParams>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, company, t } = await pageContext(params);
  const a = await getTranslations({ locale, namespace: "Approvals" });
  return {
    title: `${a("title")} · ${company.companyName[locale]} · ${t("brand")}`,
  };
}
export default async function ApprovalsPage({
  params,
}: Props): Promise<ReactElement> {
  const { locale, companyId, session, api } = await pageContext(params);
  const t = await getTranslations({ locale, namespace: "Approvals" });
  const [approvals, notifications] = await Promise.all([
    api.listApprovals(session.sessionId, companyId),
    api.listNotifications(session.sessionId, companyId, 50),
  ]);
  if (
    (!approvals.ok && approvals.error.code === "SESSION_INVALID") ||
    (!notifications.ok && notifications.error.code === "SESSION_INVALID")
  )
    redirect(`/${locale}/sign-in`);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />
      {!approvals.ok && (
        <LoadProblem problem={approvals.error} namespace="Approvals" />
      )}
      <ApprovalsQueue
        items={approvals.ok ? approvals.value.items : []}
        notifications={notifications.ok ? notifications.value.items : []}
        locale={locale}
        companyId={companyId}
        csrfToken={session.csrfToken}
        now={new Date().toISOString()}
        approvalsLoaded={approvals.ok}
        notificationsLoaded={notifications.ok}
      />
      {!notifications.ok && (
        <LoadProblem
          problem={notifications.error}
          namespace="Approvals"
          message={t("notificationsLoadError")}
        />
      )}
    </div>
  );
}
