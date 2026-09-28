"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/system/screen-states";
import { PageHeader } from "@/components/system/page-header";
function ContractError({ reset }: { reset: () => void }): ReactElement {
  const t = useTranslations("Approvals");
  return (
    <>
      <PageHeader title={t("title")} />
      <ErrorState message={t("loadError")} onRetry={reset} />
    </>
  );
}
export { ContractError as default };
