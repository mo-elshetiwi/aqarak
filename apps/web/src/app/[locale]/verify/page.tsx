import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { AuthFrame } from "@/components/auth/auth-frame";
import { VerifyForm } from "@/components/auth/verify-form";
import { cookies } from "next/headers";
import { SIGN_UP_COOKIE } from "@/lib/session/cookie";

export const dynamic = "force-dynamic";
interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const translate = await getTranslations({ locale, namespace: "Auth" });
  return { title: `${translate("verify")} · ${translate("brand")}` };
}
export default async function Page({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <AuthFrame locale={locale} page="verify" href="/verify">
      <VerifyForm
        pendingEmail={(await cookies()).get(SIGN_UP_COOKIE)?.value ?? ""}
      />
    </AuthFrame>
  );
}
