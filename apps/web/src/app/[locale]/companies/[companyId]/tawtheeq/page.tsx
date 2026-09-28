import type { ReactElement } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { NotPermittedState } from "@/components/system/screen-states";
import { PageHeader } from "@/components/system/page-header";
import { getTawtheeqClient, workflowIsMock } from "./_lib/client";
import { Board } from "./_components/board";
import { LoadFailure } from "./_components/common";
export const dynamic = "force-dynamic";
export default async function TawtheeqPage({
  params,
}: {
  params: Promise<{ locale: string; companyId: string }>;
}): Promise<ReactElement> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  const t = await getTranslations({ locale, namespace: "Tawtheeq" });
  if (!isSectionPermitted(context, "tawtheeq"))
    return (
      <>
        <PageHeader title={t("notPermitted")} />
        <NotPermittedState />
      </>
    );
  const session = await getCurrentSession();
  if (!session) notFound();
  const response = await getTawtheeqClient(
    companyId,
    session.sessionId,
  ).listRecords();
  if (!response.ok)
    return (
      <>
        <PageHeader title={t("title")} />
        <LoadFailure />
      </>
    );
  return (
    <Board
      records={response.value.records}
      locale={locale}
      companyId={companyId}
      synthetic={workflowIsMock()}
    />
  );
}
