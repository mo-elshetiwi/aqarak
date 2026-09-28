import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render-with-intl";
import { getMessages } from "@aqarak/i18n";
import { company, draft, key, setupMock } from "../_lib/test-fixtures";
import type { ContractDetail } from "../_lib/schemas";
import { ContractView } from "./contract-view";
const calls = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../_lib/actions", () => ({
  submitContract: calls.submit,
  approveOwner: vi.fn(),
  returnOwner: vi.fn(),
  acceptTenant: vi.fn(),
  returnTenant: vi.fn(),
  cancelContract: vi.fn(),
  withdrawContract: vi.fn(),
  reviseContract: vi.fn(),
}));
let fixture: ContractDetail | undefined;
beforeAll(async () => {
  const { api, login } = setupMock();
  const result = await api.create(
    await login("manager-1"),
    company,
    draft(),
    key(),
  );
  if (!result.ok) throw new Error(result.error.code);
  fixture = result.value;
});
beforeEach(() => {
  vi.clearAllMocks();
});
function detail(): ContractDetail {
  if (!fixture) throw new Error("Missing contract fixture");
  return structuredClone(fixture);
}
describe("Contract workspace evidence and refusals", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale} repeats schedule refusals at the instalment table`, async () => {
      const user = userEvent.setup();
      const messages = getMessages(locale);
      calls.submit.mockResolvedValue({
        ok: false,
        code: "SCHEDULE_TOTAL_MISMATCH",
      });
      const { container } = renderWithIntl(
        <ContractView
          detail={detail()}
          locale={locale}
          companyId={company}
          csrfToken="token"
          now="2026-09-28T00:00:00Z"
        />,
        { locale },
      );
      await user.click(
        screen.getByRole("button", { name: messages.Approvals.submit }),
      );
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: messages.Approvals.confirm,
        }),
      );
      await waitFor(() => {
        expect(
          container.querySelector("#contract-instalments-error"),
        ).toHaveTextContent(messages.Contracts.errors.SCHEDULE_TOTAL_MISMATCH);
      });
      expect(
        within(screen.getByRole("dialog")).getByRole("alert"),
      ).toHaveTextContent(messages.Contracts.errors.SCHEDULE_TOTAL_MISMATCH);
    });
  }
  it("omits the owner step and clause when the approval gate is off", async () => {
    const user = userEvent.setup();
    const d = detail();
    d.ownerGate = { value: false, frozen: false };
    renderWithIntl(
      <ContractView
        detail={d}
        locale="en"
        companyId={company}
        csrfToken="token"
        now="2026-09-28T00:00:00Z"
      />,
    );
    const timeline = screen.getByRole("list", {
      name: getMessages("en").Approval.timelineLabel,
    });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Submit for approval" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Submitting locks version 1. Omar Farouk accepts next.",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Khalid");
  });
});

for (const locale of ["en", "ar"] as const) {
  for (const confirmation of ["ai_confirmed", "ai_edited"] as const) {
    it(`${locale} renders persisted ${confirmation} clause provenance after reload`, async () => {
      const { api, login } = setupMock();
      const manager = await login("manager-1");
      const created = await api.create(manager, company, draft(), key());
      if (!created.ok) throw new Error(created.error.code);
      const id = created.value.contract.id;
      const suggestion = await api.suggestClause(
        manager,
        company,
        id,
        { textEn: "Synthetic clause" },
        key(),
      );
      if (!suggestion.ok) throw new Error(suggestion.error.code);
      const { tenantId, unitId, ...terms } = draft();
      expect(tenantId).toBeTruthy();
      expect(unitId).toBeTruthy();
      terms.specialClauses = [
        {
          textEn: "Synthetic clause",
          textAr:
            suggestion.value.suggestion.textAr +
            (confirmation === "ai_edited" ? " تعديل" : ""),
          modelTranslated: true,
          suggestionId: suggestion.value.suggestionId,
        },
      ];
      const saved = await api.edit(
        manager,
        company,
        id,
        { expectedVersion: 1, terms },
        key(),
      );
      if (!saved.ok) throw new Error(saved.error.code);
      const reloaded = await api.get(manager, company, id);
      if (!reloaded.ok) throw new Error(reloaded.error.code);
      renderWithIntl(
        <ContractView
          detail={reloaded.value}
          locale={locale}
          companyId={company}
          csrfToken="token"
          now="2026-09-28T00:00:00Z"
        />,
        { locale },
      );
      const messages = getMessages(locale).Contracts.suggestion;
      expect(
        screen.getByText("synthetic-clause-translation"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          new RegExp(
            confirmation === "ai_confirmed"
              ? messages.confirmed
              : messages.edited,
          ),
        ),
      ).toHaveTextContent(messages.label);
    });
  }
}
