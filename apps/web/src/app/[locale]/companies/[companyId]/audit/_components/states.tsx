"use client";
import { useEffect, useRef, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/system/page-header";
export function AuditNotPermitted(): ReactElement {
  const t = useTranslations("Audit");
  return (
    <div className="space-y-6">
      <PageHeader title={t("notPermitted")} />
      <p className="rounded-md border bg-muted p-6">{t("permissionReason")}</p>
    </div>
  );
}
export function AuditFailure({ retry }: { retry?: () => void }): ReactElement {
  const t = useTranslations("Audit");
  const router = useRouter();
  return (
    <div
      role="alert"
      className="space-y-4 rounded-md border border-status-danger-border p-6"
    >
      <p>{t("loadError")}</p>
      <Button
        variant="secondary"
        onClick={
          retry ??
          (() => {
            router.refresh();
          })
        }
      >
        {t("retry")}
      </Button>
    </div>
  );
}
export function AuditError({
  code,
}: {
  code: string | null;
}): ReactElement | null {
  const t = useTranslations("Audit");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (code) ref.current?.focus();
  }, [code]);
  if (!code) return null;
  const key =
    code === "VALIDATION_FAILED"
      ? "invalidFilters"
      : ["CSRF_INVALID", "SESSION_INVALID"].includes(code)
        ? "sessionError"
        : code === "NOT_PERMITTED"
          ? "permissionReason"
          : "errorHelp";
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="space-y-2 rounded-md border border-status-danger-border bg-status-danger-bg p-4 text-status-danger-fg"
    >
      <h2 className="font-semibold">{t("errorTitle")}</h2>
      <p>{t(key)}</p>
    </div>
  );
}
