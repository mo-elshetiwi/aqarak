import { z } from "zod";
import type { Role } from "../vocabulary";

/** Lists every read or draft family exposed to the signed-in person's co-worker. */
export const coWorkerToolFamily = z.enum([
  "search",
  "read",
  "explain",
  "draft_message",
  "propose_note",
  "propose_task",
  "propose_reminder",
  "records_from_documents",
  "contracts_and_schedules",
  "tawtheeq_comparison",
  "triage",
  "dispatch",
  "payments_from_uploads",
  "renewals",
  "portfolio_questions",
  "statement_questions",
  "ticket_reports",
  "own_documents",
  "own_contract",
  "own_schedule",
  "own_tickets",
  "fault_reports",
  "payment_evidence",
  "assigned_jobs",
  "job_status",
  "parts",
  "quote_drafts",
  "settings",
  "members",
  "invitations",
  "templates",
  "audit_search",
  "payments_from_receipts",
  "payments_from_slips",
  "payments_from_cheque_images",
  "invoices",
  "receipts",
  "arrears_messages",
  "statements",
]);
/** Identifies one closed co-worker family. */
export type CoWorkerToolFamily = z.infer<typeof coWorkerToolFamily>;
/** Restricts family effects to reading data or preparing a draft for a person. */
export type CoWorkerToolEffect = "read" | "draft";
/** Assigns every family a read or draft effect, enforcing IN5 without commit or approval effects. */
export const coWorkerToolEffects: Readonly<
  Record<CoWorkerToolFamily, CoWorkerToolEffect>
> = {
  search: "read",
  read: "read",
  explain: "read",
  draft_message: "draft",
  propose_note: "draft",
  propose_task: "draft",
  propose_reminder: "draft",
  records_from_documents: "draft",
  contracts_and_schedules: "draft",
  tawtheeq_comparison: "read",
  triage: "draft",
  dispatch: "draft",
  payments_from_uploads: "draft",
  renewals: "draft",
  portfolio_questions: "read",
  statement_questions: "read",
  ticket_reports: "draft",
  own_documents: "draft",
  own_contract: "read",
  own_schedule: "read",
  own_tickets: "read",
  fault_reports: "draft",
  payment_evidence: "draft",
  assigned_jobs: "read",
  job_status: "draft",
  parts: "draft",
  quote_drafts: "draft",
  settings: "draft",
  members: "draft",
  invitations: "draft",
  templates: "draft",
  audit_search: "read",
  payments_from_receipts: "draft",
  payments_from_slips: "draft",
  payments_from_cheque_images: "draft",
  invoices: "draft",
  receipts: "draft",
  arrears_messages: "draft",
  statements: "draft",
};
/** Defines the families shared by each role in stable presentation order. */
export const commonCoWorkerToolFamilies: readonly CoWorkerToolFamily[] = [
  "search",
  "read",
  "explain",
  "draft_message",
  "propose_note",
  "propose_task",
  "propose_reminder",
];
/** Defines each role's additional families, whose commands still require subject authorization. */
export const roleCoWorkerToolFamilies: Readonly<
  Record<Role, readonly CoWorkerToolFamily[]>
> = {
  manager: [
    "records_from_documents",
    "contracts_and_schedules",
    "tawtheeq_comparison",
    "triage",
    "dispatch",
    "payments_from_uploads",
    "renewals",
  ],
  owner: [
    "portfolio_questions",
    "statement_questions",
    "ticket_reports",
    "own_documents",
  ],
  tenant: [
    "own_contract",
    "own_schedule",
    "own_tickets",
    "fault_reports",
    "payment_evidence",
  ],
  technician: ["assigned_jobs", "job_status", "parts", "quote_drafts"],
  company_administrator: [
    "settings",
    "members",
    "invitations",
    "templates",
    "audit_search",
  ],
  accountant: [
    "payments_from_receipts",
    "payments_from_slips",
    "payments_from_cheque_images",
    "invoices",
    "receipts",
    "arrears_messages",
    "statements",
  ],
};
/** Returns a deduplicated union in schema order, independent of input role order; no roles means no tools. */
export function coWorkerToolFamilies(
  roles: readonly Role[],
): readonly CoWorkerToolFamily[] {
  if (roles.length === 0) return [];
  const allowed = new Set([
    ...commonCoWorkerToolFamilies,
    ...roles.flatMap((role) => roleCoWorkerToolFamilies[role]),
  ]);
  return coWorkerToolFamily.options.filter((family) => allowed.has(family));
}
