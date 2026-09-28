import { randomBytes } from "node:crypto";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/system/page-header";
import { DraftForm } from "../_components/draft-form";
import { LoadProblem } from "../_components/load-problem";
import { pageContext, type RouteParams } from "../_lib/page-context";
export const dynamic = "force-dynamic";
interface Props {
  params: Promise<RouteParams>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, company, locale } = await pageContext(params);
  return {
    title: `${t("draftTitle")} · ${company.companyName[locale]} · ${t("brand")}`,
  };
}
export default async function NewContractPage({
  params,
}: Props): Promise<ReactElement> {
  const { t, locale, companyId, session, api } = await pageContext(params);
  const options = await api.draftingOptions(session.sessionId, companyId);
  if (!options.ok && options.error.code === "SESSION_INVALID")
    redirect(`/${locale}/sign-in`);
  return (
    <>
      <PageHeader title={t("draftTitle")} description={t("fixedTemplate")} />
      {options.ok ? (
        <DraftForm
          options={options.value}
          locale={locale}
          companyId={companyId}
          csrfToken={session.csrfToken}
          commandKey={randomBytes(24).toString("base64url")}
        />
      ) : (
        <LoadProblem problem={options.error} />
      )}
    </>
  );
}
