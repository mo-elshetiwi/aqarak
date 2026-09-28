import { getMessages, type Locale } from "@aqarak/i18n";
import type { ApprovalReviewProps } from "@/components/approval/approval-review";
import type { ApprovalStepperProps } from "@/components/approval/approval-stepper";
import type { DraftedActionCardProps } from "@/components/drafted-action/drafted-action-card";
function text(
  key:
    | "layla"
    | "khalid"
    | "omar"
    | "property"
    | "draftTitle"
    | "changeLabel"
    | "changeAfter"
    | "expiry"
    | "consequence"
    | "failure",
): { en: string; ar: string } {
  return {
    en: getMessages("en").Mobile.Gallery[key],
    ar: getMessages("ar").Mobile.Gallery[key],
  };
}
/** Gallery examples carry a fixed synthetic clock and a frozen gate. */
export function galleryStepper(
  ownerGate = true,
  viewer: "owner" | "tenant" = "owner",
): ApprovalStepperProps {
  return {
    ownerGate,
    now: "2026-10-01T06:42:00Z",
    manager: {
      name: text("layla"),
      state: "done",
      decision: "submitted",
      decidedAt: "2026-09-28T06:42:00Z",
    },
    owner:
      viewer === "owner"
        ? {
            name: text("khalid"),
            state: "current",
            requestedAt: "2026-09-28T06:42:00Z",
          }
        : {
            name: text("khalid"),
            state: "done",
            decision: "approved",
            decidedAt: "2026-09-28T07:42:00Z",
          },
    tenant:
      viewer === "tenant" || !ownerGate
        ? {
            name: text("omar"),
            state: "current",
            requestedAt: "2026-09-28T07:42:00Z",
          }
        : { name: text("omar"), state: "waiting" },
  };
}
/** Owner and tenant samples share one synthetic contract snapshot. */
export function galleryReview(
  viewer: "owner" | "tenant",
  onDecision: () => void,
): ApprovalReviewProps {
  return {
    reference: "C-01",
    viewer,
    status:
      viewer === "owner"
        ? "awaiting_owner_approval"
        : "awaiting_tenant_acceptance",
    unit: { en: "104", ar: "104" },
    property: text("property"),
    tenant: text("omar"),
    owner: text("khalid"),
    startsOn: "2026-10-01",
    endsOn: "2027-09-30",
    annualRentFils: 8500000,
    instalments: 4,
    version: 2,
    changesCount: 3,
    stepper: galleryStepper(true, viewer),
    onApprove: onDecision,
    onRequestChanges: onDecision,
  };
}
/** Each state can be inspected without creating a server-side action. */
export function galleryDraft(
  state: DraftedActionCardProps["state"],
  onAction: () => void,
): DraftedActionCardProps {
  return {
    id: state,
    title: text("draftTitle"),
    state,
    kind: "action",
    origin: { channel: "voice", at: "2026-09-28T06:42:00Z" },
    changes: [{ label: text("changeLabel"), after: text("changeAfter") }],
    expiryRule: text("expiry"),
    consequence: text("consequence"),
    failureReason: state === "failed" ? text("failure") : undefined,
    onConfirm: onAction,
    onDiscard: onAction,
    onEdit: onAction,
    onOpenReview: onAction,
    onDraftAgain: onAction,
  };
}
/** Synthetic person names come from the bilingual gallery catalogue. */
export function galleryOwner(locale: Locale): string {
  return text("khalid")[locale];
}
