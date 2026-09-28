import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderContract } from "../render";
import type { Parties } from "../repository";
import type { DraftInput } from "../schema";
const migration = readFileSync(
  new URL(
    "../../../../../../packages/db/migrations/0401_standard_contract_template.sql",
    import.meta.url,
  ),
  "utf8",
);
const en = /\$en\$([\s\S]*?)\$en\$/.exec(migration)?.[1] ?? "";
const ar = /\$ar\$([\s\S]*?)\$ar\$/.exec(migration)?.[1] ?? "";
const template = {
  name_en: "Residential tenancy contract",
  name_ar: "عقد إيجار سكني",
  body_en: en,
  body_ar: ar,
};
const parties: Parties = {
  tenant: { full_name_en: "Synthetic Tenant", full_name_ar: "مستأجر اصطناعي" },
  owner: { full_name_en: "Synthetic Owner", full_name_ar: "مالك اصطناعي" },
  property: { name_en: "Synthetic Residence", name_ar: "سكن اصطناعي" },
  unit: { unit_no: "101" },
  mandate: null,
};
const draft: DraftInput = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  unitId: "00000000-0000-4000-8000-000000000002",
  termStart: "2026-10-01",
  termEnd: "2027-09-30",
  graceDays: 10,
  annualRentFils: 8500000,
  totalFils: 8500000,
  depositFils: 500000,
  vatBp: 0,
  instalments: [
    {
      seqNo: 1,
      dueOn: "2026-10-01",
      amountFils: 8500000,
      vatFils: 0,
      cheque: null,
    },
  ],
  specialClauses: [
    {
      textEn: "Synthetic extra condition.",
      textAr: "شرط إضافي اصطناعي.",
      modelTranslated: false,
    },
  ],
};
it("renders ten fixed sections and appends bilingual special clauses deterministically", () => {
  const input = {
    template,
    parties,
    draft,
    company: {
      legal_name_en: "Synthetic Company",
      legal_name_ar: "شركة اصطناعية",
    },
    contractNo: "C-01",
  };
  const rendered = renderContract(input);
  expect(renderContract(input)).toEqual(rendered);
  expect(rendered.en.sections).toHaveLength(11);
  expect(rendered.ar.sections).toHaveLength(11);
  expect(rendered.en.sections[3]?.body).toContain("AED 85,000.00");
  expect(rendered.ar.sections[3]?.body).toContain("85,000.00 درهم إماراتي");
  expect(rendered.en.sections[2]?.body).toContain("01/10/2026");
  expect(rendered.ar.sections[2]?.body).toContain("30/09/2027");
  expect(rendered.en.sections[10]).toMatchObject({
    number: 11,
    special: true,
    body: "Synthetic extra condition.",
  });
  expect(JSON.stringify(rendered)).not.toContain("{{");
  expect(Buffer.byteLength(JSON.stringify(template))).toBeLessThan(48 * 1024);
});
it("keeps both template inserts inside restored forced row security boundaries", () => {
  for (const table of ["lease.contract_template", "lease.clause"]) {
    expect(
      migration.indexOf(`alter table ${table} no force row level security`),
    ).toBeLessThan(migration.indexOf(`insert into ${table}`));
    expect(
      migration.lastIndexOf(`alter table ${table} force row level security`),
    ).toBeGreaterThan(migration.indexOf(`insert into ${table}`));
  }
});
