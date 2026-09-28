import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { ApprovalShowcase } from "./approval-showcase";
interface Props {
  params: Promise<{ locale: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Approval" });
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page({ params }: Props): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ApprovalShowcase />;
}
