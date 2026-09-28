import type { Metadata } from "next";
import type { ReactElement } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getApi } from "@/lib/api";
import { requireCompanyContext, requireSession } from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { PageHeader } from "@/components/system/page-header";
import { NotPermittedState } from "@/components/system/screen-states";
import { MembersView } from "@/components/members/members-view";
export const dynamic = "force-dynamic";
interface PageProps {
  params: Promise<{ locale: string; companyId: string }>;
}
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  const t = await getTranslations({ locale });
  const title = isSectionPermitted(context, "members")
    ? t("Members.title")
    : `${t("Shell.notPermitted")} · ${t("Members.title")}`;
  return {
    title: `${title} · ${context.companyName[locale]} · ${t("Auth.brand")}`,
  };
}
export default async function MembersPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  if (!isSectionPermitted(context, "members")) {
    const t = await getTranslations({ locale, namespace: "Shell" });
    return (
      <>
        <PageHeader title={t("notPermitted")} />
        <NotPermittedState />
      </>
    );
  }
  const session = await requireSession(locale);
  const api = getApi();
  const [members, invitations] = await Promise.allSettled([
    api.listMembers(session.sessionId, companyId),
    api.listInvitations(session.sessionId, companyId),
  ]);
  return (
    <MembersView
      companyId={companyId}
      accountId={session.me.account.id}
      members={
        members.status === "fulfilled" && members.value.ok
          ? members.value.value.members
          : null
      }
      invitations={
        invitations.status === "fulfilled" && invitations.value.ok
          ? invitations.value.value.invitations
          : null
      }
    />
  );
}
