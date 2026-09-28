import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { StatusTag } from "@/components/system/status-tag";
import type { TenantDetail } from "../_lib/j3-contract";
export function IdentityStatus({
  status,
}: {
  status: TenantDetail["identityStatus"];
}): ReactElement {
  const t = useTranslations("Tenants");
  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={t(`identityStatus.${status}`)}
    >
      {status === "pending_review" ? (
        <StatusTag entity="document_version" state="pending_review" />
      ) : status === "verified" ? (
        <>
          <StatusTag entity="document_version" state="accepted" />
          <span>{t("identityStatus.verified")}</span>
        </>
      ) : (
        <span className="text-caption text-muted-foreground">
          {t("identityStatus.missing")}
        </span>
      )}
    </span>
  );
}
export function TaskStatus({
  status,
}: {
  status: TenantDetail["checklist"][number]["status"];
}): ReactElement {
  const t = useTranslations("Tenants");
  return (
    <span className="inline-flex items-center gap-2" data-task-status={status}>
      {(status === "pending_review" ||
        status === "accepted" ||
        status === "rejected") && (
        <StatusTag entity="document_version" state={status} />
      )}
      {status !== "pending_review" && status !== "rejected" && (
        <span className="text-caption">{t(`taskStatus.${status}`)}</span>
      )}
    </span>
  );
}
