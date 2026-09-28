"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/system/page-header";
import { NotFoundState } from "@/components/system/screen-states";
function NotFound(): ReactElement {
  const translate = useTranslations("Shell");
  const auth = useTranslations("Auth");
  return (
    <main id="main" className="space-y-6 p-8">
      <title>{`${translate("notFound")} · ${auth("brand")}`}</title>
      <PageHeader title={translate("notFound")} />
      <NotFoundState />
    </main>
  );
}

export { NotFound as default };
