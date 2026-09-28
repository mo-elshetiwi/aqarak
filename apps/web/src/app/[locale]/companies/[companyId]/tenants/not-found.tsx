import type { ReactElement } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/system/page-header";
import { NotFoundState } from "@/components/system/screen-states";
async function TenantNotFound(): Promise<ReactElement> {
  const t = await getTranslations("Shell");
  return (
    <>
      <PageHeader title={t("notFound")} />
      <NotFoundState />
    </>
  );
}
export { TenantNotFound as default };
