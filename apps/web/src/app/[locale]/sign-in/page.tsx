import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { AuthFrame } from "@/components/auth/auth-frame";
import { SignInForm } from "@/components/auth/sign-in-form";

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
  return { title: `${translate("signIn")} · ${translate("brand")}` };
}
export default async function Page({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const search = await searchParams;
  return (
    <AuthFrame locale={locale} page="signIn" href="/sign-in">
      <SignInForm
        {...(typeof search.next === "string" ? { next: search.next } : {})}
        confirmed={search.confirmed === "1"}
      />
    </AuthFrame>
  );
}
