"use client";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { Button } from "@/components/ui/button";
import {
  DateText,
  IdentifierText,
  MoneyAmount,
} from "@/components/system/formatted-values";
import { StatusTag } from "@/components/system/status-tag";
import type { ActionFailure } from "../[recordId]/_actions";
import {
  fieldKeySchema,
  type FieldKey,
  type TawtheeqRecord,
} from "../_lib/schemas";
export const controlClass =
  "min-h-10 w-full rounded-md border border-input bg-background ps-3 pe-3 py-2 text-base leading-relaxed focus-visible:outline-2 focus-visible:outline-ring";
export function WorkflowStatus({
  state,
}: {
  state: TawtheeqRecord["workflowState"];
}): ReactElement {
  return <StatusTag entity="tawtheeq_record" state={state} />;
}
export function Value({
  field,
  value,
  locale,
}: {
  field: FieldKey;
  value: string | number | null;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  if (value === null || value === "") return <span>{t("unknown")}</span>;
  if (field.endsWith("_fils"))
    return <MoneyAmount fils={Number(value)} locale={locale} />;
  if (["term_start", "term_end", "registered_on"].includes(field))
    return <DateText iso={String(value)} locale={locale} />;
  if (field.includes("id_number"))
    return <IdentifierText value={String(value)} kind="emirates_id" />;
  if (field === "unt_number" || field === "tawtheeq_number")
    return (
      <IdentifierText
        value={String(value)}
        kind={field === "unt_number" ? "unt" : "tawtheeq"}
      />
    );
  if (field === "contract_type" && t.has(`contractTypes.${String(value)}`))
    return <span>{t(`contractTypes.${String(value)}`)}</span>;
  return <bdi dir="auto">{String(value)}</bdi>;
}
function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
export function Connectivity({
  namespace = "Tawtheeq",
}: { namespace?: "Tawtheeq" | "Audit" } = {}): ReactElement | null {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const t = useTranslations(namespace);
  return online ? null : (
    <p
      role="status"
      className="rounded-md border border-status-attention-border bg-status-attention-bg p-4 text-status-attention-fg"
    >
      {t("offline")}
    </p>
  );
}
export function LoadFailure({ retry }: { retry?: () => void }): ReactElement {
  const router = useRouter();
  const t = useTranslations("Tawtheeq");
  return (
    <div
      role="alert"
      className="space-y-4 rounded-md border border-status-danger-border p-6"
    >
      <p>{t("loadError")}</p>
      <Button
        variant="outline"
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
export function ActionError({
  error,
}: {
  error: ActionFailure | null;
}): ReactElement | null {
  const t = useTranslations("Tawtheeq");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  const code = error.domainCode ?? error.code;
  const label = errorLabel(code);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="space-y-2 rounded-md border border-status-danger-border bg-status-danger-bg p-4 text-status-danger-fg"
    >
      <h2 className="font-semibold">{t("errorTitle")}</h2>
      <p>{t(label)}</p>
      {Object.keys(error.fieldErrors).map((path) => {
        const parsed = fieldKeySchema.safeParse(
          path.replace(/^(input\.)?fields\./, "").replace(/\.value$/, ""),
        );
        return (
          <p key={path}>
            {path === "input.reason"
              ? t("reason")
              : parsed.success
                ? t(`fields.${parsed.data}`)
                : t("field")}
            : {t("invalidField")}
          </p>
        );
      })}
      {[
        "STALE_VERSION",
        "VERSION_CONFLICT",
        "CSRF_INVALID",
        "SESSION_INVALID",
      ].includes(code) && (
        <Button
          variant="outline"
          onClick={() => {
            window.location.reload();
          }}
        >
          {t("reload")}
        </Button>
      )}
    </div>
  );
}
function errorLabel(
  code: string,
):
  | "csrf"
  | "stale"
  | "forbidden"
  | "unavailable"
  | "scanPending"
  | "scanRejected"
  | "checksumFailed"
  | "uploadFailed"
  | "expiredUpload"
  | "errorHelp" {
  if (code === "CSRF_INVALID" || code === "SESSION_INVALID") return "csrf";
  if (code === "STALE_VERSION" || code === "VERSION_CONFLICT") return "stale";
  if (code === "NOT_PERMITTED" || code === "FORBIDDEN") return "forbidden";
  if (code === "UNAVAILABLE") return "unavailable";
  if (code === "UPLOAD_FAILED") return "uploadFailed";
  if (code === "UPLOAD_EXPIRED") return "expiredUpload";
  if (code === "SCAN_PENDING") return "scanPending";
  if (code === "SCAN_REJECTED") return "scanRejected";
  if (code === "CHECKSUM_MISMATCH") return "checksumFailed";
  return "errorHelp";
}
