import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { StatesShowcase } from "@/components/system/states-showcase";
interface Props {
  params: Promise<{ locale: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const translate = await getTranslations({ locale, namespace: "Showcase" });
  return {
    title: translate("statesTitle"),
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: Props): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <StatesShowcase />;
}
