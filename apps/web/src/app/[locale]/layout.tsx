import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  IBM_Plex_Sans,
  IBM_Plex_Sans_Arabic,
  IBM_Plex_Mono,
} from "next/font/google";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { getDirection, getMessages, isLocale, locales } from "@aqarak/i18n";
import "../globals.css";
import { ThemePreference } from "@/components/shell/theme-preference";
import { SkipLink } from "@/components/shell/skip-link";
import { ThemeScript } from "@/components/system/theme-script";
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ui-mono",
  display: "swap",
});
const latin = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui-latin",
  display: "swap",
});
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui-arabic",
  display: "swap",
});
interface LocaleParams {
  params: Promise<{ locale: string }>;
}
/** Pre-renders the two supported language routes. */
export function generateStaticParams(): { locale: string }[] {
  return locales.map((locale) => ({ locale }));
}
/** Localises the document title and description for each language. */
export async function generateMetadata({
  params,
}: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const translate = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: translate("title"),
    description: translate("description"),
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
  };
}
/** Sets document language, reading direction and the corresponding font order. */
export default async function LocaleLayout({
  children,
  params,
}: LocaleParams & { children: ReactNode }): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const direction = getDirection(locale);
  return (
    <html
      lang={locale}
      dir={direction}
      suppressHydrationWarning
      className={`${latin.variable} ${arabic.variable} ${mono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={getMessages(locale)}>
          <DirectionProvider direction={direction}>
            <ThemePreference locale={locale} />
            <SkipLink />
            {children}
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
