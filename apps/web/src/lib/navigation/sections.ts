import type { CompanyContext, StaffRole } from "@/lib/api/contract";

export type Capacity = StaffRole | "owner" | "tenant";
export interface Section {
  id: SectionId;
  icon: string;
  grantedTo: readonly Capacity[];
}
export type SectionId =
  | "home"
  | "inbox"
  | "owners"
  | "properties"
  | "tenants"
  | "contracts"
  | "tawtheeq"
  | "money"
  | "schedules"
  | "payments-receipts"
  | "invoices"
  | "charges"
  | "arrears"
  | "statements-payouts"
  | "portfolio"
  | "statements"
  | "tenancy"
  | "payments"
  | "maintenance"
  | "documents"
  | "tasks"
  | "dashboard"
  | "members"
  | "settings"
  | "templates"
  | "ai-usage"
  | "audit"
  | "export"
  | "co-worker";

export const sections: readonly Section[] = [
  { id: "home", icon: "House", grantedTo: [] },
  { id: "inbox", icon: "Inbox", grantedTo: [] },
  { id: "owners", icon: "Users", grantedTo: ["manager"] },
  { id: "properties", icon: "Building2", grantedTo: ["manager"] },
  { id: "tenants", icon: "UserRound", grantedTo: ["manager"] },
  { id: "contracts", icon: "FileSignature", grantedTo: ["manager"] },
  { id: "tawtheeq", icon: "ShieldCheck", grantedTo: ["manager"] },
  { id: "money", icon: "Wallet", grantedTo: ["manager"] },
  { id: "schedules", icon: "FileSpreadsheet", grantedTo: ["accountant"] },
  { id: "payments-receipts", icon: "Receipt", grantedTo: ["accountant"] },
  { id: "invoices", icon: "FileText", grantedTo: ["accountant"] },
  { id: "charges", icon: "Banknote", grantedTo: ["accountant"] },
  { id: "arrears", icon: "TriangleAlert", grantedTo: ["accountant"] },
  { id: "statements-payouts", icon: "Landmark", grantedTo: ["accountant"] },
  { id: "portfolio", icon: "Building2", grantedTo: ["owner"] },
  { id: "statements", icon: "FileText", grantedTo: ["owner"] },
  { id: "tenancy", icon: "KeyRound", grantedTo: ["tenant"] },
  { id: "payments", icon: "Banknote", grantedTo: ["tenant"] },
  {
    id: "maintenance",
    icon: "Wrench",
    grantedTo: ["manager", "owner", "tenant"],
  },
  {
    id: "documents",
    icon: "Folder",
    grantedTo: ["manager", "owner", "tenant"],
  },
  { id: "tasks", icon: "ListChecks", grantedTo: ["manager"] },
  { id: "dashboard", icon: "LayoutDashboard", grantedTo: ["manager"] },
  { id: "members", icon: "Users", grantedTo: ["company_administrator"] },
  { id: "settings", icon: "Settings", grantedTo: ["company_administrator"] },
  { id: "templates", icon: "FileText", grantedTo: ["company_administrator"] },
  { id: "ai-usage", icon: "ChartColumn", grantedTo: ["company_administrator"] },
  {
    id: "audit",
    icon: "History",
    grantedTo: ["manager", "company_administrator", "accountant"],
  },
  { id: "export", icon: "Download", grantedTo: ["company_administrator"] },
  { id: "co-worker", icon: "Sparkles", grantedTo: [] },
];

/** Combines staff membership and party links without duplicating capacities. */
export function capacitiesFor(context: CompanyContext): Capacity[] {
  return [
    ...new Set<Capacity>([
      ...context.staffRoles,
      ...context.partyLinks.map((link) => link.role),
    ]),
  ];
}
function permits(capacities: readonly Capacity[], section: Section): boolean {
  if (section.id === "money" && capacities.includes("accountant")) return false;
  return (
    section.grantedTo.length === 0 ||
    section.grantedTo.some((role) => capacities.includes(role))
  );
}
/** Preserves the canonical order for every union of company capacities. */
export function navigationFor(context: CompanyContext): Section[] {
  const capacities = capacitiesFor(context);
  return sections.filter((section) => permits(capacities, section));
}
export function isSectionPermitted(
  context: CompanyContext,
  sectionId: string,
): boolean {
  const section = sections.find((item) => item.id === sectionId);
  return section !== undefined && permits(capacitiesFor(context), section);
}
