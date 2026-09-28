import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/screen-states";
import { buttonVariants } from "@/components/ui/button";
import { getJ3Client } from "./_lib/j3";
import { pageAccess, hideMissing } from "./_lib/load-page";
import { tenantPath } from "./_lib/routes";
import { PageProblem } from "./_components/page-problem";
import { IdentityStatus } from "./_components/task-status";
export const dynamic = "force-dynamic";
export default async function TenantsPage({
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
  const header = (
    <PageHeader title={t("title")} description={t("description")} />
  );
  if (!auth.ok)
    return (
      <>
        {header}
        <PageProblem {...auth} />
      </>
    );
  const result = hideMissing(await getJ3Client().listTenants(auth.access));
  if (!result.ok)
    return (
      <>
        {header}
        <PageProblem {...result} />
      </>
    );
  const add = (
    <Link
      data-variant="default"
      className={buttonVariants()}
      href={`/${route.locale}/companies/${route.companyId}/tenants/new`}
    >
      {t("add")}
    </Link>
  );
  if (!result.tenants.length)
    return (
      <>
        {header}
        <EmptyState variant="no-records" message={t("empty")} />
        {add}
      </>
    );
  return (
    <>
      {header}
      {add}
      <div className="overflow-auto rounded-md border">
        <table className="w-full text-start text-caption">
          <caption className="sr-only">{t("title")}</caption>
          <thead className="bg-muted">
            <tr>
              {["name", "email", "identity", "status", "missing"].map((key) => (
                <th key={key} scope="col" className="h-10 px-3 text-start">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.tenants.map((tenant) => (
              <tr key={tenant.id} className="h-11 border-t">
                <td className="px-3">
                  <Link
                    href={tenantPath({ ...route, tenantId: tenant.id })}
                    className={buttonVariants({
                      variant: "link",
                      size: "sm",
                      className: "h-10 px-0",
                    })}
                  >
                    <bdi>{tenant.fullNameEn}</bdi>
                    {tenant.fullNameAr && (
                      <bdi dir="rtl">{tenant.fullNameAr}</bdi>
                    )}
                  </Link>
                </td>
                <td className="px-3">
                  <bdi>{tenant.email ?? t("notProvided")}</bdi>
                </td>
                <td className="px-3">
                  <bdi dir="ltr">{tenant.eidMasked ?? t("notProvided")}</bdi>
                </td>
                <td className="px-3">
                  <IdentityStatus status={tenant.identityStatus} />
                </td>
                <td className="px-3">
                  {tenant.missingRequired.length
                    ? tenant.missingRequired
                        .map((type) =>
                          t.has(`documents.${type}`)
                            ? t(`documents.${type}`)
                            : t("documents.other"),
                        )
                        .join("، ")
                    : t("none")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
