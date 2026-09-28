import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";
import { getMessages } from "@aqarak/i18n";
import { company, draft, key, setupMock } from "../_lib/test-fixtures";
import { DecisionPanel } from "./decision-panel";
import type { ActionResult, ContractDetail } from "../_lib/schemas";
const calls = vi.hoisted(() => ({
  approve: vi.fn(),
  returned: vi.fn(),
  withdraw: vi.fn(),
  cancel: vi.fn(),
  revise: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: calls.push, refresh: vi.fn() }),
}));
vi.mock("../_lib/actions", () => ({
  approveOwner: calls.approve,
  returnOwner: calls.returned,
  acceptTenant: vi.fn(),
  returnTenant: vi.fn(),
  submitContract: vi.fn(),
  cancelContract: calls.cancel,
  withdrawContract: calls.withdraw,
  reviseContract: calls.revise,
}));
async function ownerDetail(): Promise<ContractDetail> {
  const { api, login } = setupMock();
  const manager = await login("manager-1");
  const created = await api.create(manager, company, draft(), key());
  if (!created.ok) throw new Error(created.error.code);
  const submitted = await api.submit(
    manager,
    company,
    created.value.contract.id,
    { expectedVersion: 1 },
    key(),
  );
  if (!submitted.ok) throw new Error(submitted.error.code);
  return {
    ...submitted.value,
    viewer: {
      slot: "owner",
      allowedActions: ["approve_owner", "return_owner"],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Owner decision confirmations", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale} requires a reason and focuses the same inline error in the summary`, async () => {
      const user = userEvent.setup();
      const detail = await ownerDetail();
      const messages = getMessages(locale);
      renderWithIntl(
        <DecisionPanel
          detail={detail}
          locale={locale}
          companyId={company}
          csrfToken="token"
        />,
        { locale },
      );
      await user.click(
        screen.getByRole("button", { name: messages.Approvals.return_owner }),
      );
      const dialog = screen.getByRole("dialog");
      await user.click(
        within(dialog).getByRole("button", {
          name: messages.Approvals.confirm,
        }),
      );
      expect(calls.returned).not.toHaveBeenCalled();
      expect(
        within(dialog).getAllByText(messages.Contracts.errors.REASON_REQUIRED),
      ).toHaveLength(2);
      expect(within(dialog).getByRole("alert")).toHaveFocus();
      expect(within(dialog).getByRole("textbox")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    it(`${locale} names the tenant and explains immutability before approval`, async () => {
      const user = userEvent.setup();
      const detail = await ownerDetail();
      const messages = getMessages(locale);
      renderWithIntl(
        <DecisionPanel
          detail={detail}
          locale={locale}
          companyId={company}
          csrfToken="token"
        />,
        { locale },
      );
      await user.click(
        screen.getByRole("button", {
          name: messages.Approvals.approve_owner.replace("{version}", "1"),
        }),
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(
        messages.Approvals.approveEffect
          .replaceAll("{version}", "1")
          .replaceAll("{tenant}", detail.tenant.name[locale]),
      );
      expect(calls.approve).not.toHaveBeenCalled();
      await user.click(
        within(dialog).getByRole("button", { name: messages.Approvals.close }),
      );
      expect(
        screen.getByRole("button", {
          name: messages.Approvals.approve_owner.replace("{version}", "1"),
        }),
      ).toHaveFocus();
    });
  }
  it("uses one random key per confirmation tap and disables a pending confirmation", async () => {
    const user = userEvent.setup();
    const detail = await ownerDetail();
    let resolve: ((value: ActionResult) => void) | undefined;
    calls.approve
      .mockImplementationOnce(
        () =>
          new Promise<ActionResult>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" });
    renderWithIntl(
      <DecisionPanel
        detail={detail}
        locale="en"
        companyId={company}
        csrfToken="token"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Approve version 1" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Saving decision…",
      }),
    ).toBeDisabled();
    await act(async () => {
      resolve?.({ ok: false, code: "UNAVAILABLE" });
      await Promise.resolve();
    });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    const first: unknown = calls.approve.mock.calls[0]?.[0];
    const second: unknown = calls.approve.mock.calls[1]?.[0];
    expect(first).not.toEqual(second);
    expect(first).toMatchObject({
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) as unknown,
    });
  });
});

for (const locale of ["en", "ar"] as const) {
  for (const action of ["withdraw", "cancel_draft"] as const) {
    it(`${locale} requires the manager to confirm ${action} with a reason`, async () => {
      const detail = await ownerDetail();
      detail.viewer = { slot: "manager", allowedActions: [action] };
      detail.contract.status =
        action === "withdraw" ? "awaiting_owner_approval" : "draft";
      const call = action === "withdraw" ? calls.withdraw : calls.cancel;
      call.mockResolvedValue({ ok: true, contractId: detail.contract.id });
      const m = getMessages(locale);
      renderWithIntl(
        <DecisionPanel
          detail={detail}
          locale={locale}
          companyId={company}
          csrfToken="token"
        />,
        { locale },
      );
      await userEvent.click(
        screen.getByRole("button", { name: m.Approvals[action] }),
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(
        m.Approvals[
          action === "withdraw" ? "withdrawEffect" : "cancelEffect"
        ].replace("{version}", "1"),
      );
      expect(call).not.toHaveBeenCalled();
      await userEvent.click(
        within(dialog).getByRole("button", { name: m.Approvals.confirm }),
      );
      expect(call).not.toHaveBeenCalled();
      await userEvent.type(
        within(dialog).getByRole("textbox", { name: m.Approvals.reason }),
        "Revise the rent",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: m.Approvals.confirm }),
      );
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { expectedVersion: 1, reason: "Revise the rent" },
        }),
      );
    });
  }
}
