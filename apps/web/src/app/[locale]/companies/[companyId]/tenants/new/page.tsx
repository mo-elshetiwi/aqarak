import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { buttonVariants } from "@/components/ui/button";
import { pageAccess } from "../_lib/load-page";
import { PageProblem } from "../_components/page-problem";
import { CreateTenantForm } from "../_components/create-tenant-form";
export const dynamic = "force-dynamic";
export default async function NewTenantPage({
  params,
}: {
  params: Promise<{ locale: string; companyId: string }>;
}): Promise<ReactElement> {
  const route = await params;
  const auth = await pageAccess(route);
  const t = await getTranslations({
    locale: route.locale,
    namespace: "Tenants",
  });
  return (
    <>
      <PageHeader title={t("create.title")} />
      {auth.ok ? (
        <>
          <CreateTenantForm route={route} />
          <Link
            className={buttonVariants({ variant: "link" })}
            href={`/${route.locale}/companies/${route.companyId}/tenants`}
          >
            {t("back")}
          </Link>
        </>
      ) : (
        <PageProblem {...auth} />
      )}
    </>
  );
}
