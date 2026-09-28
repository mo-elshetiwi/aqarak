import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { StatusTag } from "@/components/system/status-tag";
import { buttonVariants } from "@/components/ui/button";
import { isMockApi } from "@/lib/api";
import {
  loadReview,
  hideMissing,
} from "@/app/[locale]/companies/[companyId]/tenants/_lib/load-page";
import { getJ3Client } from "@/app/[locale]/companies/[companyId]/tenants/_lib/j3";
import { fieldCatalogue } from "@/app/[locale]/companies/[companyId]/tenants/_lib/j3-contract";
import {
  tenantPath,
  type ReviewRoute,
} from "@/app/[locale]/companies/[companyId]/tenants/_lib/routes";
import { PageProblem } from "@/app/[locale]/companies/[companyId]/tenants/_components/page-problem";
import { ReviewForm } from "@/app/[locale]/companies/[companyId]/tenants/_components/review-form";
export const dynamic = "force-dynamic";
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<ReviewRoute>;
  searchParams: Promise<{ field?: string }>;
}): Promise<ReactElement> {
  const route = await params;
  const result = await loadReview(route);
  const t = await getTranslations({
    locale: route.locale,
    namespace: "Documents",
  });
  const header = (
    <PageHeader title={t("reviewTitle")} description={t("nothingSaved")} />
  );
  if (!result.ok)
    return (
      <>
        {header}
        <PageProblem {...result} />
      </>
    );
  const content = hideMissing(
    await getJ3Client().getContent(result.access, route),
  );
  if (!content.ok)
    return (
      <>
        {header}
        <PageProblem {...content} />
      </>
    );
  const requested = (await searchParams).field;
  const changeField = fieldCatalogue.find(
    (field) => field.name === requested,
  )?.name;
  return (
    <>
      {header}
      <StatusTag
        entity="document_version"
        state={result.version.reviewStatus}
      />
      <ReviewForm
        route={route}
        version={result.version}
        imageUrl={content.url}
        synthetic={isMockApi()}
        {...(changeField ? { changeField } : {})}
      />
      <Link
        href={tenantPath(route)}
        className={buttonVariants({ variant: "link" })}
      >
        {t("reviewBack")}
      </Link>
    </>
  );
}
