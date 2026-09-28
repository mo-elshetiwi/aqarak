import { z } from "zod";
/** Local state IDs remain here until the domain package exports the drafted-action schema. */
export const draftedActionStateSchema = z.enum([
  "drafting",
  "ready",
  "committed",
  "rejected",
  "expired",
  "failed",
]);
/** Local state IDs remain here until the domain package exports the approval schema. */
export const approvalStateSchema = z.enum([
  "requested",
  "approved",
  "changes_requested",
  "voided",
]);
/** Local state IDs remain here until the domain package exports the contract schema. */
export const contractStateSchema = z.enum([
  "draft",
  "awaiting_owner_approval",
  "awaiting_tenant_acceptance",
  "concluded",
  "ended",
  "cancelled",
]);
/** A domain and its state are validated together so labels cannot cross maps. */
export const statusTagSchema = z.discriminatedUnion("domain", [
  z.object({
    domain: z.literal("draftedAction"),
    state: draftedActionStateSchema,
  }),
  z.object({ domain: z.literal("approval"), state: approvalStateSchema }),
  z.object({ domain: z.literal("contract"), state: contractStateSchema }),
]);
/** Status inputs retain the vocabulary of their owning domain. */
export type StatusTagProps = z.infer<typeof statusTagSchema>;
/** Shared tone assignments keep semantics independent of the interface language. */
export const stateTones = {
  drafting: "progress",
  ready: "attention",
  committed: "success",
  rejected: "muted",
  expired: "muted",
  failed: "danger",
  requested: "attention",
  approved: "success",
  changes_requested: "danger",
  voided: "muted",
  draft: "neutral",
  awaiting_owner_approval: "attention",
  awaiting_tenant_acceptance: "attention",
  concluded: "success",
  ended: "muted",
  cancelled: "muted",
} as const;
