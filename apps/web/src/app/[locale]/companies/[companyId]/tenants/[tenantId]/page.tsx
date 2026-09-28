import type { ReactElement } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getJ3Client } from "../_lib/j3";
import { pageAccess, hideMissing } from "../_lib/load-page";
import { reviewPath, type TenantRoute } from "../_lib/routes";
import { PageProblem } from "../_components/page-problem";
import { IdentityStatus, TaskStatus } from "../_components/task-status";
import { InvitationCard } from "../_components/invitation-card";
import { CaptureSheet } from "../_components/capture-sheet";
export const dynamic = "force-dynamic";
export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<TenantRoute>;
  searchParams: Promise<{ identity?: string }>;
}): Promise<ReactElement> {
  const route = await params;
  const auth = await pageAccess(route);
  const t = await getTranslations({
    locale: route.locale,
    namespace: "Tenants",
  });
  if (!auth.ok)
    return (
      <>
        <PageHeader title={t("title")} />
        <PageProblem {...auth} />
      </>
    );
  const result = hideMissing(
    await getJ3Client().getTenant(auth.access, route.tenantId),
  );
  if (!result.ok)
    return (
      <>
        <PageHeader title={t("title")} />
        <PageProblem {...result} />
      </>
    );
  const tenant = result.tenant;
  const name =
    route.locale === "ar"
      ? (tenant.fullNameAr ?? tenant.fullNameEn)
      : tenant.fullNameEn;
  const contactComplete = Boolean(tenant.email && tenant.preferredLanguage);
  const waiting = tenant.checklist.find(
    (item) => item.status === "pending_review",
  );
  const completed =
    tenant.checklist.filter((item) => item.status === "accepted").length +
    Number(contactComplete);
  return (
    <>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-h1">
            {t("onboard")} <bdi>{name}</bdi>
          </h1>
          <IdentityStatus status={tenant.identityStatus} />
        </div>
        <p className="text-muted-foreground">
          {t(
            waiting
              ? "nextActor"
              : tenant.identityStatus === "verified"
                ? "completeActor"
                : "uploadActor",
          )}
        </p>
      </header>
      {(await searchParams).identity === "saved" && (
        <p
          role="status"
          className="rounded-md border bg-status-success-bg p-4 text-status-success-fg"
        >
          {t("saved")}
        </p>
      )}
      <InvitationCard route={route} tenant={tenant} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-4" aria-labelledby="tasks-heading">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 id="tasks-heading" className="text-h2">
              {t("tasks")}
            </h2>
            <p>
              {t("completed", {
                count: completed,
                total: tenant.checklist.length + 1,
              })}
            </p>
          </div>
          <ul className="divide-y rounded-md border bg-card">
            {tenant.checklist.map((item) => {
              const ref =
                item.documentId && item.latestVersionId
                  ? {
                      ...route,
                      documentId: item.documentId,
                      versionId: item.latestVersionId,
                    }
                  : null;
              const supported = item.docType === "emirates_id";
              return (
                <li
                  key={item.docType}
                  className="flex flex-wrap items-center justify-between gap-4 p-4"
                >
                  <div>
                    <h3 className="text-body-strong">
                      {t.has(`documents.${item.docType}`)
                        ? t(`documents.${item.docType}`)
                        : t("documents.other")}
                    </h3>
                    <p className="text-caption text-muted-foreground">
                      {t(item.required ? "required" : "optional")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <TaskStatus status={item.status} />
                    {supported && ref && item.status === "pending_review" ? (
                      <Link
                        data-variant={item === waiting ? "default" : "outline"}
                        className={buttonVariants({
                          variant: item === waiting ? "default" : "outline",
                        })}
                        href={reviewPath(ref)}
                      >
                        {t("review")}
                      </Link>
                    ) : supported &&
                      ["missing", "rejected", "expired"].includes(
                        item.status,
                      ) ? (
                      <CaptureSheet
                        route={route}
                        uploadAgain={
                          item.status === "rejected" ||
                          item.status === "expired"
                        }
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <h3 className="text-body-strong">{t("contact")}</h3>
                <p className="text-caption">
                  <bdi dir="ltr">{tenant.email ?? t("notProvided")}</bdi> ·{" "}
                  <bdi dir="ltr">{tenant.phoneE164 ?? t("notProvided")}</bdi> ·{" "}
                  {t(tenant.preferredLanguage)}
                </p>
              </div>
              <TaskStatus status={contactComplete ? "accepted" : "missing"} />
            </li>
          </ul>
          <p className="rounded-md border bg-muted p-4">{t("noVisa")}</p>
        </section>
        {waiting && (
          <aside className="space-y-4 rounded-md border bg-card p-6">
            <h2 className="text-h2">{t("waiting")}</h2>
            <TaskStatus status="pending_review" />
            <p>{t("waitingDescription")}</p>
          </aside>
        )}
      </div>
      <Link
        href={`/${route.locale}/companies/${route.companyId}/tenants`}
        className={buttonVariants({ variant: "link" })}
      >
        {t("back")}
      </Link>
    </>
  );
}
