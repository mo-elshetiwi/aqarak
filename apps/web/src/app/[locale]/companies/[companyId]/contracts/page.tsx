import type { Metadata } from "next";
import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/system/page-header";
import { ContractsList } from "./_components/contracts-list";
import { LoadProblem } from "./_components/load-problem";
import { statusSchema } from "./_lib/schemas";
import { pageContext, type RouteParams } from "./_lib/page-context";
export const dynamic = "force-dynamic";
interface Props {
  params: Promise<RouteParams>;
  searchParams: Promise<{ cursor?: string; status?: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, locale, company } = await pageContext(params);
  return {
    title: `${t("title")} · ${company.companyName[locale]} · ${t("brand")}`,
  };
}
export default async function ContractsPage({
  params,
  searchParams,
}: Props): Promise<ReactElement> {
  const { t, locale, companyId, session, api } = await pageContext(params);
  const { cursor, status: requestedStatus } = await searchParams;
  const status = statusSchema.safeParse(requestedStatus).data;
  const [result, options] = await Promise.all([
    api.list(session.sessionId, companyId, {
      limit: 50,
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    api.draftingOptions(session.sessionId, companyId),
  ]);
  if (!result.ok) {
    if (result.error.code === "SESSION_INVALID") redirect(`/${locale}/sign-in`);
    return (
      <>
        <PageHeader title={t("title")} />
        <LoadProblem problem={result.error} />
      </>
    );
  }
  return (
    <ContractsList
      items={result.value.items}
      nextCursor={result.value.nextCursor}
      canDraft={options.ok}
      locale={locale}
      companyId={companyId}
      {...(status ? { status } : {})}
    />
  );
}
