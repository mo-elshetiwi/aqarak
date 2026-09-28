import type { ReactElement, ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@aqarak/i18n";
import { BrandMark } from "@/components/system/brand-mark";
import { LanguageSwitch } from "@/components/system/language-switch";
import { OfflineBanner } from "@/components/system/screen-states";
import { Link } from "@/i18n/navigation";
import { isMockApi } from "@/lib/api";
export async function AuthFrame({
  locale,
  page,
  href,
  children,
}: {
  locale: Locale;
  page: "signIn" | "signUp" | "verify" | "company";
  href: string;
  children: ReactNode;
}): Promise<ReactElement> {
  const translate = await getTranslations({ locale, namespace: "Auth" });
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-5">
      <div className="flex min-h-svh flex-col bg-sidebar text-sidebar-foreground lg:col-span-3">
        <header className="flex items-center justify-between gap-4 p-6 lg:p-8">
          <BrandMark locale={locale} size={40} />
          <LanguageSwitch href={href} />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 flex-col items-center justify-center gap-6 p-6"
        >
          <div className="w-full max-w-100 space-y-6 rounded-md border bg-card p-8 text-card-foreground">
            <div className="space-y-2">
              <h1 className="text-h1">{translate(page)}</h1>
              <p className="text-body text-muted-foreground">
                {translate(`${page}Description`)}
              </p>
            </div>
            {children}
          </div>
          {page === "signIn" ? (
            <div className="max-w-100 space-y-4 text-center">
              <p>
                {translate("managingProperties")}{" "}
                <Link
                  href="/sign-up"
                  className="inline-flex min-h-6 text-brand underline underline-offset-4"
                >
                  {translate("createCompanyAccount")}
                </Link>
              </p>
              <p className="text-caption text-muted-foreground">
                {translate("invitation")}
              </p>
            </div>
          ) : (
            page !== "company" && (
              <Link
                href="/sign-in"
                className="inline-flex min-h-6 text-brand underline underline-offset-4"
              >
                {translate("signIn")}
              </Link>
            )
          )}
          {isMockApi() && (
            <p className="max-w-100 text-center text-caption text-muted-foreground">
              {translate("mockNotice")}
            </p>
          )}
          <OfflineBanner />
        </main>
        <footer className="p-6 text-caption text-muted-foreground lg:p-8">
          {translate("copyright")}
        </footer>
      </div>
      <aside className="hidden items-end bg-foreground p-12 text-background lg:col-span-2 lg:flex">
        <p className="max-w-md text-display">{translate("statement")}</p>
      </aside>
    </div>
  );
}
