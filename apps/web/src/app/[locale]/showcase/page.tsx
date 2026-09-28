import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { Link } from "@/i18n/navigation";
import { FoundationsShowcase } from "@/components/system/foundations-showcase";
interface Props {
  params: Promise<{ locale: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const translate = await getTranslations({ locale, namespace: "Showcase" });
  return { title: translate("title"), robots: { index: false, follow: false } };
}
export default async function Page({ params }: Props): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const review = await getTranslations({ locale, namespace: "Review" });
  const approval = await getTranslations({ locale, namespace: "Approval" });
  return (
    <>
      <nav className="ms-auto me-auto flex max-w-7xl flex-wrap gap-6 ps-8 pe-8 pt-6">
        <Link
          href="/showcase/review"
          className="inline-flex min-h-8 items-center text-brand underline"
        >
          {review("title")}
        </Link>
        <Link
          href="/showcase/approval"
          className="inline-flex min-h-8 items-center text-brand underline"
        >
          {approval("title")}
        </Link>
      </nav>
      <FoundationsShowcase locale={locale} />
    </>
  );
}
