import type { Metadata } from "next";
import type { ReactElement } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireCompanyContext } from "@/lib/session/session";
import {
  capacitiesFor,
  isSectionPermitted,
  sections,
} from "@/lib/navigation/sections";
import { PageHeader } from "@/components/system/page-header";
import {
  EmptyState,
  NotPermittedState,
} from "@/components/system/screen-states";
export const dynamic = "force-dynamic";
interface PageProps {
  params: Promise<{ locale: string; companyId: string; section: string }>;
}
async function resolvePage(params: PageProps["params"]) {
  const { locale, companyId, section: segment } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  const section = sections.find((item) => item.id === segment);
  if (!section) notFound();
  const translate = await getTranslations({ locale });
  return {
    locale,
    context,
    section,
    translate,
    permitted: isSectionPermitted(context, section.id),
  };
}
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { context, locale, section, translate, permitted } =
    await resolvePage(params);
  const title = permitted
    ? translate(`Navigation.sections.${section.id}`)
    : `${translate("Shell.notPermitted")} · ${translate(`Navigation.sections.${section.id}`)}`;
  return {
    title: `${title} · ${context.companyName[locale]} · ${translate("Auth.brand")}`,
  };
}
export default async function SectionPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { context, section, translate, permitted } = await resolvePage(params);
  if (!permitted)
    return (
      <>
        <PageHeader title={translate("Shell.notPermitted")} />
        <NotPermittedState />
      </>
    );
  const description =
    section.id === "home"
      ? "homeDescription"
      : section.id === "inbox"
        ? "inboxDescription"
        : section.id === "co-worker"
          ? "coWorkerLimits"
          : "companyRecords";
  const capacities = capacitiesFor(context);
  return (
    <>
      <PageHeader
        title={translate(`Navigation.sections.${section.id}`)}
        description={translate(`Shell.${description}`)}
      />
      {section.id === "home" &&
        capacities.length === 1 &&
        capacities[0] === "technician" && (
          <p
            role="status"
            className="rounded-md border bg-status-neutral-bg p-4 text-status-neutral-fg"
          >
            {translate("Shell.mobileJobs")}
          </p>
        )}
      <EmptyState
        variant="no-records"
        message={translate(`Navigation.empty.${section.id}`)}
      />
    </>
  );
}
