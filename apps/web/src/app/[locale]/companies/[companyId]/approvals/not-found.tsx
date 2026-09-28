"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { NotFoundState } from "@/components/system/screen-states";
import { PageHeader } from "@/components/system/page-header";
function Missing(): ReactElement {
  const t = useTranslations("Approvals");
  return (
    <>
      <PageHeader title={t("notFound")} />
      <NotFoundState />
    </>
  );
}
export { Missing as default };
