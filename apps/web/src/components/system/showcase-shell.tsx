"use client";
import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "./page-header";
import { LanguageSwitch } from "./language-switch";
import { ThemeSwitch } from "./theme-switch";
export function ShowcaseShell({
  states = false,
  children,
}: {
  states?: boolean;
  children: ReactNode;
}): ReactElement {
  const translate = useTranslations("Showcase");
  return (
    <main className="ms-auto me-auto flex max-w-7xl flex-col gap-8 ps-8 pe-8 py-8">
      <nav
        aria-label={translate("foundations")}
        className="flex flex-wrap items-center justify-between gap-6"
      >
        <div className="flex gap-4">
          <Link
            className="inline-flex min-h-8 items-center text-brand underline underline-offset-4"
            href="/showcase"
            aria-current={!states ? "page" : undefined}
          >
            {translate("foundations")}
          </Link>
          <Link
            className="inline-flex min-h-8 items-center text-brand underline underline-offset-4"
            href="/showcase/states"
            aria-current={states ? "page" : undefined}
          >
            {translate("states")}
          </Link>
        </div>
        <LanguageSwitch href={states ? "/showcase/states" : "/showcase"} />
      </nav>
      <PageHeader
        title={translate(states ? "statesTitle" : "title")}
        description={translate(states ? "statesDescription" : "description")}
      />
      <ThemeSwitch />
      {children}
    </main>
  );
}
export function ShowcaseSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="space-y-6 rounded-md border bg-card p-6 text-card-foreground">
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}
