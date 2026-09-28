import type { CompanyContext, CompanyKind, StaffRole } from "./contract";

/** Shared synthetic credential, restricted to the single-process mock. */
export const MOCK_ONLY_PASSWORD = "Demo-Only-246810!";
export const MOCK_CONFIRMATION_CODE = "246810";
export const MOCK_COMPANY_A_ID = "10000000-0000-4000-8000-000000000001";
export const MOCK_COMPANY_B_ID = "10000000-0000-4000-8000-000000000002";
export const MOCK_ACCOUNT_IDS = {
  "manager-1": "20000000-0000-4000-8000-000000000001",
  "owner-1": "20000000-0000-4000-8000-000000000002",
  "tenant-1": "20000000-0000-4000-8000-000000000003",
  "technician-1": "20000000-0000-4000-8000-000000000004",
  "admin-1": "20000000-0000-4000-8000-000000000005",
  "accountant-1": "20000000-0000-4000-8000-000000000006",
  "owner-2": "20000000-0000-4000-8000-000000000007",
  "unconfirmed-1": "20000000-0000-4000-8000-000000000008",
} as const;
export const MOCK_PARTY_IDS = {
  "owner-1": "30000000-0000-4000-8000-000000000001",
  "tenant-1": "30000000-0000-4000-8000-000000000002",
  "owner-2-a": "30000000-0000-4000-8000-000000000003",
  "owner-2-b": "30000000-0000-4000-8000-000000000004",
} as const;
export const MOCK_COMPANIES = {
  a: {
    companyId: MOCK_COMPANY_A_ID,
    companyName: {
      en: "Aqarak Demo Properties",
      ar: "عقارك للعقارات (تجريبي)",
    },
    companyKind: "management_company" as CompanyKind,
    isDemo: true,
  },
  b: {
    companyId: MOCK_COMPANY_B_ID,
    companyName: {
      en: "Mariam Al Nuaimi Properties",
      ar: "أملاك مريم النعيمي",
    },
    companyKind: "self_managed_owner" as CompanyKind,
    isDemo: true,
  },
};
function staffContext(role: StaffRole): CompanyContext {
  return { ...MOCK_COMPANIES.a, staffRoles: [role], partyLinks: [] };
}
export const MOCK_ACCOUNTS = [
  {
    handle: "manager-1",
    name: { en: "Layla Haddad", ar: "ليلى حداد" },
    email: "layla.haddad@example.com",
    confirmed: true,
    contexts: [staffContext("manager")],
  },
  {
    handle: "owner-1",
    name: { en: "Khalid Al Suwaidi", ar: "خالد السويدي" },
    email: "khalid.alsuwaidi@example.com",
    confirmed: true,
    contexts: [
      {
        ...MOCK_COMPANIES.a,
        staffRoles: [],
        partyLinks: [{ role: "owner", partyId: MOCK_PARTY_IDS["owner-1"] }],
      },
    ],
  },
  {
    handle: "tenant-1",
    name: { en: "Omar Farouk", ar: "عمر فاروق" },
    email: "omar.farouk@example.com",
    confirmed: true,
    contexts: [
      {
        ...MOCK_COMPANIES.a,
        staffRoles: [],
        partyLinks: [{ role: "tenant", partyId: MOCK_PARTY_IDS["tenant-1"] }],
      },
    ],
  },
  {
    handle: "technician-1",
    name: { en: "Anil Kumar", ar: "أنيل كومار" },
    email: "anil.kumar@example.com",
    confirmed: true,
    contexts: [staffContext("technician")],
  },
  {
    handle: "admin-1",
    name: { en: "Hassan Ali", ar: "حسن علي" },
    email: "hassan.ali@example.com",
    confirmed: true,
    contexts: [staffContext("company_administrator")],
  },
  {
    handle: "accountant-1",
    name: { en: "Noor Saleh", ar: "نور صالح" },
    email: "noor.saleh@example.com",
    confirmed: true,
    contexts: [staffContext("accountant")],
  },
  {
    handle: "owner-2",
    name: { en: "Mariam Al Nuaimi", ar: "مريم النعيمي" },
    email: "mariam.alnuaimi@example.com",
    confirmed: true,
    contexts: [
      {
        ...MOCK_COMPANIES.a,
        staffRoles: [],
        partyLinks: [{ role: "owner", partyId: MOCK_PARTY_IDS["owner-2-a"] }],
      },
      {
        ...MOCK_COMPANIES.b,
        staffRoles: ["company_administrator", "manager"],
        partyLinks: [{ role: "owner", partyId: MOCK_PARTY_IDS["owner-2-b"] }],
      },
    ],
  },
  {
    handle: "unconfirmed-1",
    name: { en: "Sara Nasser", ar: "سارة ناصر" },
    email: "sara.nasser@example.com",
    confirmed: false,
    contexts: [],
  },
] satisfies {
  handle: keyof typeof MOCK_ACCOUNT_IDS;
  name: { en: string; ar: string };
  email: string;
  confirmed: boolean;
  contexts: CompanyContext[];
}[];
