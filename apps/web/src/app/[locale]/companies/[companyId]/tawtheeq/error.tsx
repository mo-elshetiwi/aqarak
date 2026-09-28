"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/system/page-header";
import { LoadFailure } from "./_components/common";
function ErrorPage({ reset }: { reset: () => void }): ReactElement {
  const t = useTranslations("Tawtheeq");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />
      <LoadFailure retry={reset} />
    </div>
  );
}
export { ErrorPage as default };
