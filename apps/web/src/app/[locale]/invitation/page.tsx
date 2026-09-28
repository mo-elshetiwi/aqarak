import type { Metadata } from "next";
import type { ReactElement } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentSession } from "@/lib/session/session";
import { SessionProvider } from "@/components/shell/session-context";
import { InvitationView } from "@/components/invitation/invitation-view";
export const dynamic = "force-dynamic";
interface PageProps {
  params: Promise<{ locale: string }>;
}
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale });
  return {
    title: `${t("Members.invitationTitle")} · ${t("Auth.brand")}`,
    robots: { index: false, follow: false },
  };
}
export default async function InvitationPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const result = await getCurrentSession()
    .then((session) => ({ session, unavailable: false }))
    .catch(() => ({ session: null, unavailable: true }));
  return (
    <SessionProvider csrfToken={result.session?.csrfToken ?? ""}>
      <InvitationView
        signedIn={Boolean(result.session)}
        sessionUnavailable={result.unavailable}
      />
    </SessionProvider>
  );
}
