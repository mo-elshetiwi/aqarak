import type { ReactNode } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session/session";
import { SessionProvider } from "@/components/shell/session-context";
export const dynamic = "force-dynamic";
export default async function SetupLayout({
  params,
  children,
}: {
  params: Promise<{ locale: string }>;
  children: ReactNode;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await requireSession(locale);
  return (
    <SessionProvider csrfToken={session.csrfToken}>{children}</SessionProvider>
  );
}
