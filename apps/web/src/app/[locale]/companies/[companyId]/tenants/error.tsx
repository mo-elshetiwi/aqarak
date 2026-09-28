"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/system/page-header";
import { ErrorState } from "@/components/system/screen-states";
function TenantError({ reset }: { reset: () => void }): ReactElement {
  const t = useTranslations("Tenants");
  return (
    <>
      <PageHeader title={t("title")} />
      <ErrorState onRetry={reset} />
    </>
  );
}
export { TenantError as default };
