import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { loadReview } from "@/app/[locale]/companies/[companyId]/tenants/_lib/load-page";
import type { ReviewRoute } from "@/app/[locale]/companies/[companyId]/tenants/_lib/routes";
import { PageProblem } from "@/app/[locale]/companies/[companyId]/tenants/_components/page-problem";
import { CheckAnswers } from "@/app/[locale]/companies/[companyId]/tenants/_components/check-answers";
export const dynamic = "force-dynamic";
export default async function CheckPage({
  params,
}: {
  params: Promise<ReviewRoute>;
}): Promise<ReactElement> {
  const route = await params;
  const result = await loadReview(route);
  const t = await getTranslations({
    locale: route.locale,
    namespace: "Documents",
  });
  return (
    <>
      <PageHeader title={t("checkTitle")} description={t("checkSubtitle")} />
      {result.ok ? (
        <CheckAnswers
          route={route}
          tenantVersion={result.tenant.version}
          version={result.version}
        />
      ) : (
        <PageProblem {...result} />
      )}
    </>
  );
}
