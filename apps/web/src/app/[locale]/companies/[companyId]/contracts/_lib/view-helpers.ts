import type { Locale } from "@aqarak/i18n";
import type { ApprovalStep } from "@/components/approval/approval-timeline";
import type { ContractDetail } from "./schemas";
export function hashPrefix(hash: string): string {
  return (
    hash
      .slice(0, 16)
      .match(/.{1,4}/g)
      ?.join(" ") ?? ""
  );
}
export function approvalSteps(
  detail: ContractDetail,
  locale: Locale,
  managerLabel: string,
): ApprovalStep[] {
  return (["manager", "owner", "tenant"] as const).map((slot) => {
    const approval = detail.approvals.find((entry) => entry.slot === slot);
    const personName =
      slot === "owner"
        ? (detail.owner?.name[locale] ?? managerLabel)
        : slot === "tenant"
          ? detail.tenant.name[locale]
          : (approval?.personName ?? managerLabel);
    return {
      slot,
      personName,
      status:
        approval?.status === "returned"
          ? "changes_requested"
          : (approval?.status ?? "waiting"),
      decidedAt: approval?.decidedAt ?? null,
      requestedAt: approval?.requestedAt ?? null,
    };
  });
}
export function randomCommandKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
