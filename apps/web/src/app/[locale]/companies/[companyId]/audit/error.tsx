"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/system/page-header";
import { AuditFailure } from "./_components/states";
function ErrorPage({ reset }: { reset: () => void }): ReactElement {
  const t = useTranslations("Audit");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />
      <AuditFailure retry={reset} />
    </div>
  );
}
export { ErrorPage as default };
