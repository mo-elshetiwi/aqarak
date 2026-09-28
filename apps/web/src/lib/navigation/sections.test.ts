import { describe, expect, it } from "vitest";
import { MOCK_COMPANIES, MOCK_ACCOUNTS } from "@/lib/api/mock-fixtures";
import type { CompanyContext } from "@/lib/api/contract";
import {
  navigationFor,
  isSectionPermitted,
  sections,
  capacitiesFor,
} from "./sections";
const cases: [string, CompanyContext, string[]][] = [
  [
    "manager",
    { ...MOCK_COMPANIES.a, staffRoles: ["manager"], partyLinks: [] },
    [
      "home",
      "inbox",
      "owners",
      "properties",
      "tenants",
      "contracts",
      "tawtheeq",
      "money",
      "maintenance",
      "documents",
      "tasks",
      "dashboard",
      "audit",
      "co-worker",
    ],
  ],
  [
    "owner",
    {
      ...MOCK_COMPANIES.a,
      staffRoles: [],
      partyLinks: [
        { role: "owner", partyId: "30000000-0000-4000-8000-000000000099" },
      ],
    },
    [
      "home",
      "inbox",
      "portfolio",
      "statements",
      "maintenance",
      "documents",
      "co-worker",
    ],
  ],
  [
    "tenant",
    {
      ...MOCK_COMPANIES.a,
      staffRoles: [],
      partyLinks: [
        { role: "tenant", partyId: "30000000-0000-4000-8000-000000000099" },
      ],
    },
    [
      "home",
      "inbox",
      "tenancy",
      "payments",
      "maintenance",
      "documents",
      "co-worker",
    ],
  ],
  [
    "technician",
    { ...MOCK_COMPANIES.a, staffRoles: ["technician"], partyLinks: [] },
    ["home", "inbox", "co-worker"],
  ],
  [
    "company_administrator",
    {
      ...MOCK_COMPANIES.a,
      staffRoles: ["company_administrator"],
      partyLinks: [],
    },
    [
      "home",
      "inbox",
      "members",
      "settings",
      "templates",
      "ai-usage",
      "audit",
      "export",
      "co-worker",
    ],
  ],
  [
    "accountant",
    { ...MOCK_COMPANIES.a, staffRoles: ["accountant"], partyLinks: [] },
    [
      "home",
      "inbox",
      "schedules",
      "payments-receipts",
      "invoices",
      "charges",
      "arrears",
      "statements-payouts",
      "audit",
      "co-worker",
    ],
  ],
  [
    "manager-accountant",
    {
      ...MOCK_COMPANIES.a,
      staffRoles: ["manager", "accountant"],
      partyLinks: [],
    },
    [
      "home",
      "inbox",
      "owners",
      "properties",
      "tenants",
      "contracts",
      "tawtheeq",
      "schedules",
      "payments-receipts",
      "invoices",
      "charges",
      "arrears",
      "statements-payouts",
      "maintenance",
      "documents",
      "tasks",
      "dashboard",
      "audit",
      "co-worker",
    ],
  ],
];
describe("company navigation", () => {
  it.each(cases)("orders the exact %s sections", (_name, context, expected) => {
    expect(navigationFor(context).map((section) => section.id)).toEqual(
      expected,
    );
    for (const section of sections)
      expect(isSectionPermitted(context, section.id)).toBe(
        expected.includes(section.id),
      );
    expect(isSectionPermitted(context, "unknown")).toBe(false);
  });
  it("unions administrator, manager and owner capacities without duplicates", () => {
    const context = MOCK_ACCOUNTS.find(
      (account) => account.handle === "owner-2",
    )?.contexts[1];
    if (!context) throw new Error("Missing synthetic context");
    expect(navigationFor(context).map((section) => section.id)).toEqual(
      "home inbox owners properties tenants contracts tawtheeq money portfolio statements maintenance documents tasks dashboard members settings templates ai-usage audit export co-worker".split(
        " ",
      ),
    );
    expect(
      capacitiesFor({
        ...context,
        partyLinks: [...context.partyLinks, ...context.partyLinks],
      }),
    ).toEqual(["company_administrator", "manager", "owner"]);
  });
});
