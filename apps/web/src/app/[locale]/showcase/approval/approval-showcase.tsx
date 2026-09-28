"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitch } from "@/components/system/language-switch";
import { ThemeSwitch } from "@/components/system/theme-switch";
import {
  ApprovalTimeline,
  PendingApprovalState,
  type ApprovalStep,
} from "@/components/approval/approval-timeline";
const now = "2026-09-28T10:00:00+04:00";
const yesterday = "2026-09-27T10:00:00+04:00";
const requestedAt = "2026-09-26T10:00:00+04:00";
const version = { number: 1, hashPrefix: "9f3c 7a02 b81e a21e" };
export function ApprovalShowcase(): ReactElement {
  const t = useTranslations("Approval");
  const steps: ApprovalStep[] = [
    {
      slot: "manager",
      personName: t("people.manager"),
      status: "approved",
      decidedAt: yesterday,
      requestedAt,
    },
    {
      slot: "owner",
      personName: t("people.owner"),
      status: "requested",
      decidedAt: null,
      requestedAt,
    },
    {
      slot: "tenant",
      personName: t("people.tenant"),
      status: "waiting",
      decidedAt: null,
      requestedAt: null,
    },
  ];
  const tenantSteps = steps.map((step): ApprovalStep =>
    step.slot === "tenant"
      ? { ...step, status: "requested", requestedAt: yesterday }
      : step,
  );
  const concluded = steps.map((step): ApprovalStep => ({
    ...step,
    status: "approved",
    decidedAt: now,
  }));
  const changes = steps.map((step): ApprovalStep =>
    step.slot === "owner"
      ? { ...step, status: "changes_requested", decidedAt: yesterday }
      : step,
  );
  return (
    <main className="ms-auto me-auto max-w-7xl space-y-8 ps-4 pe-4 py-8 md:ps-8 md:pe-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-h1">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <LanguageSwitch href="/showcase/approval" />
      </div>
      <ThemeSwitch />
      <section aria-labelledby="owner-example" className="space-y-4">
        <h2 id="owner-example" className="text-h2">
          {t("examples.owner")}
        </h2>
        <PendingApprovalState
          contractState="awaiting_owner_approval"
          steps={steps}
          ownerGate
          now={now}
          viewerSlot="owner"
          version={version}
        />
      </section>
      <section aria-labelledby="tenant-example" className="space-y-4">
        <h2 id="tenant-example" className="text-h2">
          {t("examples.tenant")}
        </h2>
        <PendingApprovalState
          contractState="awaiting_tenant_acceptance"
          steps={tenantSteps}
          ownerGate={false}
          now={now}
          viewerSlot="tenant"
          version={version}
        />
      </section>
      <section aria-labelledby="concluded-example" className="space-y-4">
        <h2 id="concluded-example" className="text-h2">
          {t("examples.concluded")}
        </h2>
        <ApprovalTimeline
          steps={concluded}
          ownerGate
          now={now}
          version={version}
        />
      </section>
      <section aria-labelledby="changes-example" className="space-y-4">
        <h2 id="changes-example" className="text-h2">
          {t("examples.changes")}
        </h2>
        <ApprovalTimeline
          steps={changes}
          ownerGate
          now={now}
          version={version}
        />
      </section>
    </main>
  );
}
