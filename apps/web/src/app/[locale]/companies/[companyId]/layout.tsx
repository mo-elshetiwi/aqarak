import type { ReactNode } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { isMockApi } from "@/lib/api";
import { SessionProvider } from "@/components/shell/session-context";
import { AppShell } from "@/components/shell/app-shell";
export const dynamic = "force-dynamic";
export default async function CompanyLayout({
  params,
  children,
}: {
  params: Promise<{ locale: string; companyId: string }>;
  children: ReactNode;
}): Promise<ReactNode> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  const session = await getCurrentSession();
  if (!session) notFound();
  return (
    <SessionProvider csrfToken={session.csrfToken}>
      <AppShell
        locale={locale}
        context={context}
        contexts={session.me.contexts}
        displayName={session.me.account.displayName}
        mock={isMockApi()}
      >
        {children}
      </AppShell>
    </SessionProvider>
  );
}
