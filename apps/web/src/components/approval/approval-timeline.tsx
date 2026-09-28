"use client";
import type { ReactElement } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Check, LockKeyhole, X } from "lucide-react";
import { isLocale } from "@aqarak/i18n";
import { DateText } from "@/components/system/formatted-values";
import { StatusTag } from "@/components/system/status-tag";
export interface ApprovalStep {
  slot: "manager" | "owner" | "tenant";
  personName: string;
  status: "requested" | "approved" | "changes_requested" | "voided" | "waiting";
  decidedAt: string | null;
  requestedAt: string | null;
}
export interface ApprovalTimelineProps {
  steps: ApprovalStep[];
  ownerGate: boolean;
  now: string;
  viewerSlot?: ApprovalStep["slot"];
  version?: { number: number; hashPrefix: string };
}
const slots = ["manager", "owner", "tenant"] as const;
export function ApprovalTimeline({
  steps,
  ownerGate,
  now,
  viewerSlot,
  version,
}: ApprovalTimelineProps): ReactElement {
  const t = useTranslations("Approval");
  const visible = slots.flatMap((slot) => {
    if (slot === "owner" && !ownerGate) return [];
    const step = steps.find((entry) => entry.slot === slot);
    return step ? [step] : [];
  });
  const currentIndex = visible.findIndex(
    (step) =>
      step.status === "requested" || step.status === "changes_requested",
  );
  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      <ol
        aria-label={t("timelineLabel")}
        className="flex flex-col gap-6 md:flex-row md:gap-0"
      >
        {visible.map((step, index) => (
          <li
            key={step.slot}
            data-slot={step.slot}
            aria-current={index === currentIndex ? "step" : undefined}
            className="relative min-w-0 flex-1 ps-10 md:ps-0 md:pe-6"
          >
            {index < visible.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute start-3 [inset-block-start:1.5rem] h-[calc(100%+1.5rem)] w-0.5 md:start-6 md:[inset-block-start:0.75rem] md:h-0.5 md:w-[calc(100%-1.5rem)] ${step.status === "approved" ? "bg-status-success-solid" : "bg-border"}`}
              />
            )}
            <StepDot status={step.status} current={index === currentIndex} />
            <div className="relative space-y-2 md:mt-3">
              <p className="text-caption text-muted-foreground">
                {t(`role.${step.slot}`)}
                {step.slot === viewerSlot
                  ? ` · ${t("you")}`
                  : step.slot === "manager" && step.status === "approved"
                    ? ` · ${t("submitted")}`
                    : ""}
              </p>
              <p className="text-body-strong">
                <bdi>{step.personName}</bdi>
              </p>
              {step.status === "waiting" ? (
                <p className="text-caption text-muted-foreground">
                  {t("waiting")}
                </p>
              ) : (
                <StatusTag entity="approval" state={step.status} />
              )}
              <StepTime
                step={step}
                now={now}
                current={index === currentIndex}
                viewerSlot={viewerSlot}
                precedingViewer={visible[index - 1]?.slot === viewerSlot}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4 text-caption text-muted-foreground">
        <p>{t(ownerGate ? "ownerGateOn" : "ownerGateOff")}</p>
        {version && (
          <bdi dir="ltr" className="font-mono">
            {t("version", { number: version.number, hash: version.hashPrefix })}
          </bdi>
        )}
      </div>
    </div>
  );
}
function StepDot({
  status,
  current,
}: {
  status: ApprovalStep["status"];
  current: boolean;
}): ReactElement {
  const tone =
    status === "approved"
      ? "border-status-success-solid bg-status-success-solid text-primary-foreground"
      : status === "changes_requested"
        ? "border-status-danger-solid bg-status-danger-bg text-status-danger-fg"
        : current
          ? "border-brand bg-card"
          : "border-border bg-card";
  return (
    <span
      aria-hidden="true"
      className={`absolute start-0 [inset-block-start:0] grid size-6 place-items-center rounded-full border-2 md:relative ${tone}`}
    >
      {status === "approved" ? (
        <Check className="size-4" />
      ) : status === "changes_requested" ? (
        <X className="size-4" />
      ) : current ? (
        <span className="size-2 rounded-full bg-brand" />
      ) : null}
    </span>
  );
}
function StepTime({
  step,
  now,
  current,
  viewerSlot,
  precedingViewer,
}: {
  step: ApprovalStep;
  now: string;
  current: boolean;
  viewerSlot: ApprovalStep["slot"] | undefined;
  precedingViewer: boolean;
}): ReactElement {
  const t = useTranslations("Approval");
  const rawLocale = useLocale();
  const format = useFormatter();
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const timestamp = step.decidedAt ?? step.requestedAt;
  const age = step.requestedAt
    ? Math.max(
        0,
        Math.floor((Date.parse(now) - Date.parse(step.requestedAt)) / 86400000),
      )
    : 0;
  return (
    <div className="space-y-2 text-caption">
      {timestamp && (
        <p className="text-muted-foreground">
          <DateText iso={timestamp} locale={locale} /> ·{" "}
          <bdi>
            {format.dateTime(new Date(timestamp), {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Dubai",
            })}
          </bdi>
        </p>
      )}
      {current && step.status === "requested" && (
        <p className="text-brand">
          {t.rich("waitingFor", {
            person: (chunks) => <bdi>{chunks}</bdi>,
            name: step.personName,
            role: t(`roleInSentence.${step.slot}`),
          })}{" "}
          · {t("age", { count: age })}
          {viewerSlot === step.slot && (
            <span className="block">{t("waitingForYou")}</span>
          )}
        </p>
      )}
      {step.status === "waiting" && (
        <p className="text-muted-foreground">
          {t(precedingViewer ? "actsAfter" : "actsLater")}
        </p>
      )}
    </div>
  );
}
export function PendingApprovalState({
  contractState,
  ...props
}: ApprovalTimelineProps & {
  contractState: "awaiting_owner_approval" | "awaiting_tenant_acceptance";
}): ReactElement {
  const t = useTranslations("Approval");
  return (
    <div className="space-y-4">
      <StatusTag entity="contract" state={contractState} />
      <ApprovalTimeline {...props} />
      <p className="flex items-start gap-2 rounded-md border bg-muted p-4 text-body-dense text-foreground">
        <LockKeyhole aria-hidden="true" className="mt-1 size-4 shrink-0" />
        {t("locked")}
      </p>
    </div>
  );
}
