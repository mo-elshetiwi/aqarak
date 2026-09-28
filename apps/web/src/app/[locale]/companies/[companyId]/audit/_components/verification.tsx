"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import type { Anchor, Verification } from "../_lib/schemas";
export function auditTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    timeZone: "Asia/Dubai",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}
function ResultText({
  value,
  busy,
}: {
  value: Verification | null;
  busy: string | null;
}): ReactElement {
  const t = useTranslations("Audit");
  if (busy === "verify") return <p>{t("verifying")}</p>;
  if (busy === "anchor") return <p>{t("anchoring")}</p>;
  if (!value) return <p>{t("neutral")}</p>;
  if (value.ok) return <p>{t("verified")}</p>;
  const seq = value.recomputed.break?.seq ?? value.sql.firstBadSeq;
  const kind =
    value.recomputed.break?.kind ?? (value.anchorProblem ? "anchor" : "sql");
  return (
    <p>{t("broken", { seq: seq ?? t("unknown"), kind: t(`kinds.${kind}`) })}</p>
  );
}
export function VerificationBanner({
  value,
  anchor,
  busy,
  locale,
}: {
  value: Verification | null;
  anchor: Anchor | null;
  busy: string | null;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Audit");
  const tone = value
    ? value.ok
      ? "border-status-success-border bg-status-success-bg text-status-success-fg"
      : "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
    : "bg-muted";
  const checkpoint = anchor ?? value?.anchor;
  return (
    <section
      aria-live="polite"
      aria-atomic="true"
      data-testid="verification-banner"
      className={`space-y-2 rounded-md border p-4 ${tone}`}
    >
      <div className="font-semibold">
        <ResultText value={value} busy={busy} />
      </div>
      {value && (
        <p>
          {value.firstSeq === null
            ? t("noRange")
            : t("range", {
                first: value.firstSeq,
                last: value.lastSeq ?? value.firstSeq,
                count: value.eventCount,
              })}
        </p>
      )}
      <p>
        {checkpoint
          ? t("anchor", {
              seq: checkpoint.seq,
              time: auditTime(checkpoint.anchoredAt, locale),
            })
          : t("noAnchor")}
      </p>
      {checkpoint && (
        <bdi dir="ltr" className="block break-all font-mono text-caption">
          {checkpoint.headHash}
        </bdi>
      )}
      {value?.anchorProblem && (
        <p>{t("anchorProblem", { problem: value.anchorProblem })}</p>
      )}
    </section>
  );
}
