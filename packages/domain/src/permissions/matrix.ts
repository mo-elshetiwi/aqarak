import { z } from "zod";
import type { Role } from "../vocabulary";

/** Lists authorization levels, with denial represented by an empty matrix cell. */
export const permissionLevel = z.enum(["A", "S", "R", "P", "G"]);
/** Describes a granted authorization level. */
export type PermissionLevel = z.infer<typeof permissionLevel>;
/** Lists commands that require an authorization decision. */
export const permissionOperation = z.enum([
  "read",
  "write",
  "request",
  "approve",
]);
/** Describes the operation being authorized. */
export type PermissionOperation = z.infer<typeof permissionOperation>;
/** Lists the stable capability keys used by navigation and command authorization. */
export const capability = z.enum([
  "company_settings",
  "staff_memberships",
  "party_links",
  "owners",
  "owner_bank_details",
  "properties_units",
  "tenants_occupants",
  "identity_documents",
  "contracts",
  "approval_steps",
  "tawtheeq",
  "payments",
  "invoices_receipts",
  "owner_statements",
  "ticket_report",
  "ticket_management",
  "job_updates",
  "notes",
  "tasks_reminders",
  "audit_read",
  "export",
  "co_worker",
]);
/** Identifies an authorization capability. */
export type Capability = z.infer<typeof capability>;

/** Defines the exact role cells as immutable literal data; empty cells deny access. */
export const permissionMatrix = {
  company_settings: {
    manager: ["R"],
    owner: [],
    tenant: [],
    technician: [],
    company_administrator: ["A"],
    accountant: ["R"],
  },
  staff_memberships: {
    manager: ["R"],
    owner: [],
    tenant: [],
    technician: [],
    company_administrator: ["A"],
    accountant: [],
  },
  party_links: {
    manager: ["A"],
    owner: [],
    tenant: [],
    technician: [],
    company_administrator: ["A"],
    accountant: [],
  },
  owners: {
    manager: ["A"],
    owner: ["S"],
    tenant: [],
    technician: [],
    company_administrator: ["R"],
    accountant: ["R"],
  },
  owner_bank_details: {
    manager: ["A"],
    owner: ["S"],
    tenant: [],
    technician: [],
    company_administrator: [],
    accountant: ["A"],
  },
  properties_units: {
    manager: ["A"],
    owner: ["R", "P"],
    tenant: ["R"],
    technician: ["R"],
    company_administrator: ["R"],
    accountant: ["R"],
  },
  tenants_occupants: {
    manager: ["A"],
    owner: ["R"],
    tenant: ["S"],
    technician: ["R"],
    company_administrator: ["R"],
    accountant: ["R"],
  },
  identity_documents: {
    manager: ["A"],
    owner: ["S"],
    tenant: ["S"],
    technician: [],
    company_administrator: [],
    accountant: [],
  },
  contracts: {
    manager: ["A"],
    owner: ["R"],
    tenant: ["R"],
    technician: [],
    company_administrator: ["R"],
    accountant: ["R"],
  },
  approval_steps: {
    manager: ["G"],
    owner: ["G"],
    tenant: ["G"],
    technician: [],
    company_administrator: [],
    accountant: [],
  },
  tawtheeq: {
    manager: ["A"],
    owner: ["R"],
    tenant: ["R"],
    technician: [],
    company_administrator: ["R"],
    accountant: ["R"],
  },
  payments: {
    manager: ["A"],
    owner: ["R"],
    tenant: ["P", "R"],
    technician: [],
    company_administrator: ["R"],
    accountant: ["A"],
  },
  invoices_receipts: {
    manager: ["A"],
    owner: ["R"],
    tenant: ["R"],
    technician: [],
    company_administrator: ["R"],
    accountant: ["A"],
  },
  owner_statements: {
    manager: ["A"],
    owner: ["R"],
    tenant: [],
    technician: [],
    company_administrator: ["R"],
    accountant: ["A"],
  },
  ticket_report: {
    manager: ["A"],
    owner: ["S"],
    tenant: ["S"],
    technician: ["S"],
    company_administrator: [],
    accountant: [],
  },
  ticket_management: {
    manager: ["A"],
    owner: ["R"],
    tenant: ["R"],
    technician: [],
    company_administrator: [],
    accountant: ["R"],
  },
  job_updates: {
    manager: ["A"],
    owner: [],
    tenant: [],
    technician: ["S"],
    company_administrator: [],
    accountant: [],
  },
  notes: {
    manager: ["A"],
    owner: ["S"],
    tenant: ["S"],
    technician: ["S"],
    company_administrator: ["R"],
    accountant: ["S"],
  },
  tasks_reminders: {
    manager: ["A"],
    owner: ["S"],
    tenant: ["S"],
    technician: ["S"],
    company_administrator: ["A"],
    accountant: ["S"],
  },
  audit_read: {
    manager: ["A"],
    owner: ["S"],
    tenant: ["S"],
    technician: ["S"],
    company_administrator: ["A"],
    accountant: ["S"],
  },
  export: {
    manager: ["A"],
    owner: ["S"],
    tenant: ["S"],
    technician: [],
    company_administrator: ["A"],
    accountant: ["S"],
  },
  co_worker: {
    manager: ["S"],
    owner: ["S"],
    tenant: ["S"],
    technician: ["S"],
    company_administrator: ["S"],
    accountant: ["S"],
  },
} as const satisfies Readonly<
  Record<Capability, Readonly<Record<Role, readonly PermissionLevel[]>>>
>;

/** Lists role-specific approval steps; cost steps are classified against the owner's threshold. */
export const permissionApprovalStep = z.enum([
  "submit",
  "cost_within_owner_threshold",
  "gated_approval",
  "reapproval",
  "skip_confirmation",
  "cost_above_owner_threshold",
  "acceptance",
  "completion_confirmation",
]);
/** Describes the approval step derived by the command handler from trusted subject facts. */
export type PermissionApprovalStep = z.infer<typeof permissionApprovalStep>;
/** Assigns each approval step to its sole eligible role. */
export const approvalStepRoles: Readonly<Record<PermissionApprovalStep, Role>> =
  {
    submit: "manager",
    cost_within_owner_threshold: "manager",
    gated_approval: "owner",
    reapproval: "owner",
    skip_confirmation: "owner",
    cost_above_owner_threshold: "owner",
    acceptance: "tenant",
    completion_confirmation: "tenant",
  };
