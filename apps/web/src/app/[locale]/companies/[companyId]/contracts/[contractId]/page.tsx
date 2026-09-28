import type { Result } from "@aqarak/domain";
import type { Locale } from "@aqarak/i18n";
import type { Problem } from "../_lib/schemas";
import { randomBytes } from "node:crypto";
import { ChangesSince } from "../_components/changes-since";
import { DraftEditor } from "../_components/draft-editor";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/system/page-header";
import { pageContext, type RouteParams } from "../_lib/page-context";
import { ContractView } from "../_components/contract-view";
import { LoadProblem } from "../_components/load-problem";
export const dynamic = "force-dynamic";
interface Props {
  params: Promise<RouteParams>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, company, locale, api, session, companyId, contractId } =
    await pageContext(params);
  const result = await api.get(session.sessionId, companyId, contractId ?? "");
  const title = result.ok
    ? t("detailTitle", { number: result.value.contract.contractNo })
    : t("notFound");
  return { title: `${title} · ${company.companyName[locale]} · ${t("brand")}` };
}
export default async function ContractPage({
  params,
}: Props): Promise<ReactElement> {
  const { t, locale, companyId, contractId, session, api } =
    await pageContext(params);
  const result = await api.get(session.sessionId, companyId, contractId ?? "");
  if (!result.ok) {
    if (result.error.code === "SESSION_INVALID") redirect(`/${locale}/sign-in`);
    return (
      <>
        <PageHeader title={t("title")} />
        <LoadProblem problem={result.error} />
      </>
    );
  }
  const [options, predecessor] = await Promise.all([
    result.value.viewer.allowedActions.includes("edit")
      ? api.draftingOptions(session.sessionId, companyId)
      : null,
    result.value.predecessor
      ? api.get(session.sessionId, companyId, result.value.predecessor.id)
      : null,
  ]);
  redirectExpired([options, predecessor], locale);
  return (
    <ContractView
      detail={result.value}
      locale={locale}
      companyId={companyId}
      csrfToken={session.csrfToken}
      now={new Date().toISOString()}
      {...(predecessor
        ? {
            comparison: predecessor.ok ? (
              <ChangesSince
                detail={result.value}
                predecessor={predecessor.value}
                locale={locale}
              />
            ) : (
              <LoadProblem problem={predecessor.error} />
            ),
          }
        : {})}
      {...(options?.ok
        ? {
            editor: (
              <DraftEditor
                detail={result.value}
                options={options.value}
                locale={locale}
                companyId={companyId}
                csrfToken={session.csrfToken}
                commandKey={randomBytes(24).toString("base64url")}
              />
            ),
          }
        : options
          ? { editor: <LoadProblem problem={options.error} /> }
          : {})}
    />
  );
}

function redirectExpired(
  results: (Result<unknown, Problem> | null)[],
  locale: Locale,
): void {
  for (const result of results)
    if (result && !result.ok && result.error.code === "SESSION_INVALID")
      redirect(`/${locale}/sign-in`);
}
