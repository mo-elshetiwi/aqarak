import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { company, draft, key, setupMock } from "../_lib/test-fixtures";
import { termsInputSchema, type ContractDetail } from "../_lib/schemas";
import { termChanges } from "../_lib/term-changes";
import { ChangesSince } from "./changes-since";
async function returnedRevision(): Promise<{
  previous: ContractDetail;
  revised: ContractDetail;
}> {
  const { api, login } = setupMock();
  const manager = await login("manager-1");
  const owner = await login("owner-1");
  const created = await api.create(manager, company, draft(), key());
  if (!created.ok) throw new Error(created.error.code);
  const id = created.value.contract.id;
  await api.submit(manager, company, id, { expectedVersion: 1 }, key());
  const returned = await api.returnOwner(
    owner,
    company,
    id,
    { expectedVersion: 1, reason: "Review rent" },
    key(),
  );
  if (!returned.ok) throw new Error(returned.error.code);
  const revision = await api.revise(
    manager,
    company,
    id,
    { expectedVersion: 1 },
    key(),
  );
  if (!revision.ok) throw new Error(revision.error.code);
  const terms = termsInputSchema.strip().parse(draft());
  terms.annualRentFils = 9000000;
  const edited = await api.edit(
    manager,
    company,
    revision.value.contract.id,
    { expectedVersion: 1, terms },
    key(),
  );
  if (!edited.ok) throw new Error(edited.error.code);
  return { previous: returned.value, revised: edited.value };
}
describe("Revision comparison", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale} shows old and new annual rent after an owner return and manager revision`, async () => {
      const { previous, revised } = await returnedRevision();
      const m = getMessages(locale).Contracts;
      renderWithIntl(
        <ChangesSince
          detail={revised}
          predecessor={previous}
          locale={locale}
        />,
        { locale },
      );
      expect(
        screen.getByRole("heading", {
          name: m.changes.title.replace(
            "{number}",
            previous.contract.contractNo,
          ),
        }),
      ).toBeInTheDocument();
      const row = screen.getByRole("row", { name: new RegExp(m.rent) });
      expect(within(row).getByText(/85,000.00/)).toBeInTheDocument();
      expect(within(row).getByText(/90,000.00/)).toBeInTheDocument();
      expect(row.textContent).not.toMatch(/[٠-٩]/);
    });
  }
  it("reports no changed terms for an identical revision", async () => {
    const { previous } = await returnedRevision();
    renderWithIntl(
      <ChangesSince detail={previous} predecessor={previous} locale="en" />,
    );
    expect(screen.getByText("No term changed")).toBeInTheDocument();
  });
  it("compares dates, rent, deposit, grace, VAT, added, removed and changed instalments and clauses", async () => {
    const { previous } = await returnedRevision();
    const after = structuredClone(previous.version);
    after.termStart = "2026-11-01";
    after.termEnd = "2027-10-31";
    after.annualRentFils = 9000000;
    after.totalFils = 9000000;
    after.depositFils = 450000;
    after.graceDays = 5;
    after.vatBp = 500;
    const first = after.instalments[0];
    if (!first) throw new Error("Missing instalment");
    first.amountFils += 100;
    after.instalments = after.instalments.filter((item) => item.seqNo !== 2);
    after.instalments.push({ ...first, seqNo: 5 });
    previous.version.specialClauses = [
      {
        position: 1,
        textEn: "Old",
        textAr: "قديم",
        suggestion: null,
        modelTranslated: false,
      },
      {
        position: 2,
        textEn: "Removed",
        textAr: "محذوف",
        suggestion: null,
        modelTranslated: false,
      },
    ];
    after.specialClauses = [
      {
        position: 1,
        textEn: "New",
        textAr: "جديد",
        suggestion: null,
        modelTranslated: false,
      },
      {
        position: 3,
        textEn: "Added",
        textAr: "مضاف",
        suggestion: null,
        modelTranslated: false,
      },
    ];
    const changes = termChanges(previous.version, after);
    expect(changes).toHaveLength(13);
    expect(
      changes.filter((change) => change.kind === "instalment"),
    ).toHaveLength(3);
    expect(changes.filter((change) => change.kind === "clause")).toHaveLength(
      3,
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "instalment", number: 2, after: null }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "instalment", number: 5, before: null }),
    );
  });
});
