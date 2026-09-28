import type { statusTones } from "@aqarak/ui-tokens";

/** Entity states and their fixed semantic tones. */
export const statusCatalogue = {
  unit: {
    vacant: "neutral",
    listed: "progress",
    reserved: "attention",
    occupied: "success",
    notice_given: "attention",
    under_maintenance: "progress",
    blocked: "danger",
  },
  contract: {
    draft: "neutral",
    awaiting_owner_approval: "attention",
    awaiting_tenant_acceptance: "attention",
    concluded: "success",
    ended: "muted",
    cancelled: "muted",
  },
  tawtheeq_record: {
    awaiting_registration: "attention",
    submitted_on_portal: "progress",
    under_review: "progress",
    discrepancies_open: "danger",
    awaiting_owner_reapproval: "attention",
    registered: "success",
    skipped: "muted",
    closed: "muted",
  },
  instalment: {
    open: "neutral",
    partly_paid: "attention",
    paid: "success",
    waived: "muted",
    cancelled: "muted",
  },
  cheque: {
    pending: "neutral",
    received: "progress",
    deposited: "progress",
    cleared: "success",
    partly_paid: "attention",
    bounced: "danger",
    replaced: "muted",
    returned_to_drawer: "muted",
  },
  invoice: {
    draft: "neutral",
    issued: "progress",
    partly_paid: "attention",
    paid: "success",
    credited: "muted",
  },
  receipt: {
    issued: "success",
    voided: "muted",
  },
  ticket: {
    reported: "neutral",
    triaged: "progress",
    awaiting_quote: "attention",
    awaiting_cost_approval: "attention",
    scheduled: "progress",
    in_progress: "progress",
    on_hold: "attention",
    work_completed: "success",
    closed: "muted",
    cancelled: "muted",
  },
  document_version: {
    pending_review: "attention",
    accepted: "success",
    rejected: "danger",
    superseded: "muted",
  },
  drafted_action: {
    drafting: "progress",
    ready: "attention",
    committed: "success",
    rejected: "muted",
    expired: "muted",
    failed: "danger",
  },
  approval: {
    requested: "attention",
    approved: "success",
    changes_requested: "danger",
    voided: "muted",
  },
  membership: {
    invited: "attention",
    active: "success",
    suspended: "danger",
    removed: "muted",
  },
  invitation: {
    pending: "attention",
    accepted: "success",
    expired: "muted",
    revoked: "muted",
  },
} as const satisfies Record<string, Record<string, keyof typeof statusTones>>;

export type StatusEntity = keyof typeof statusCatalogue;
export type StatusTagProps = {
  [E in StatusEntity]: { entity: E; state: keyof (typeof statusCatalogue)[E] };
}[StatusEntity];

/** Entries retain each entity and state relationship when used in catalogues. */
export const statusEntries: StatusTagProps[] = Object.entries(
  statusCatalogue,
).flatMap(([entity, states]) =>
  Object.keys(states).map((state) => ({ entity, state }) as StatusTagProps),
);
