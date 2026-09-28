import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { domainLabel, getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { postJsonData } from "@/lib/client/post-json";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import type { Membership } from "@/lib/api/contract";
import {
  MemberActions,
  MemberActionForm,
  type MemberAction,
} from "./member-actions";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/client/post-json", () => ({ postJsonData: vi.fn() }));
const member: Membership = {
  membershipId: MOCK_COMPANY_A_ID,
  accountId: MOCK_COMPANY_A_ID,
  displayName: "Synthetic Member",
  email: "member@example.com",
  staffRoles: ["manager"],
  status: "active",
  version: 7,
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
for (const locale of ["en", "ar"] as const) {
  const t = getMessages(locale).Members;
  it.each(["suspend", "remove"] as const)(
    `M-1 %s validates reason and sends version in ${locale}`,
    async (action) => {
      const done = vi.fn();
      vi.mocked(postJsonData).mockResolvedValue({
        ok: true,
        data: { ok: true },
      });
      renderWithIntl(
        <MemberActionForm
          companyId={MOCK_COMPANY_A_ID}
          member={member}
          action={action}
          onDone={done}
          onReload={vi.fn()}
        />,
        { locale },
      );
      fireEvent.click(screen.getByRole("button", { name: t[action] }));
      expect(screen.getByText(t.reasonRequired)).toBeVisible();
      expect(postJsonData).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText(t.reason), {
        target: { value: "Access review" },
      });
      fireEvent.click(screen.getByRole("button", { name: t[action] }));
      await waitFor(() => {
        expect(done).toHaveBeenCalledOnce();
      });
      expect(postJsonData).toHaveBeenCalledWith(
        expect.stringContaining(`/${action}`),
        expect.objectContaining({
          expectedVersion: 7,
          reason: "Access review",
          locale,
        }),
        expect.anything(),
        expect.anything(),
      );
    },
  );
  it(`M-1 validates role selection and sends version for roles and reactivation in ${locale}`, async () => {
    vi.mocked(postJsonData).mockResolvedValue({ ok: true, data: { ok: true } });
    for (const action of ["roles", "reactivate"] as const) {
      const done = vi.fn();
      renderWithIntl(
        <MemberActionForm
          companyId={MOCK_COMPANY_A_ID}
          member={member}
          action={action}
          onDone={done}
          onReload={vi.fn()}
        />,
        { locale },
      );
      if (action === "roles") {
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: domainLabel(locale, "staffRole", "manager"),
          }),
        );
        fireEvent.click(screen.getByRole("button", { name: t.changeRoles }));
        expect(screen.getByRole("alert")).toHaveTextContent(t.roleRequired);
        expect(postJsonData).not.toHaveBeenCalled();
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: domainLabel(locale, "staffRole", "accountant"),
          }),
        );
      }
      fireEvent.click(
        screen.getByRole("button", {
          name: action === "roles" ? t.changeRoles : t.reactivate,
        }),
      );
      await waitFor(() => {
        expect(done).toHaveBeenCalledOnce();
      });
      expect(postJsonData).toHaveBeenLastCalledWith(
        expect.stringContaining(`/${action}`),
        expect.objectContaining({ expectedVersion: 7 }),
        expect.anything(),
        expect.anything(),
      );
      cleanup();
    }
  });
  it.each([
    "VERSION_CONFLICT",
    "LAST_ADMINISTRATOR",
    "ACTIVE_MEMBERSHIP_ELSEWHERE",
    "FORBIDDEN",
    "UNAVAILABLE",
  ] as const)(
    `M-2 %s remains beside the action and retains reason in ${locale}`,
    async (code) => {
      vi.mocked(postJsonData).mockResolvedValue({ ok: false, code });
      const reload = vi.fn();
      renderWithIntl(
        <MemberActionForm
          companyId={MOCK_COMPANY_A_ID}
          member={member}
          action="suspend"
          onDone={vi.fn()}
          onReload={reload}
        />,
        { locale },
      );
      fireEvent.change(screen.getByLabelText(t.reason), {
        target: { value: "Keep my reason" },
      });
      fireEvent.click(screen.getByRole("button", { name: t.suspend }));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(t[code]),
      );
      expect(screen.getByLabelText(t.reason)).toHaveValue("Keep my reason");
      if (code === "VERSION_CONFLICT") {
        fireEvent.click(screen.getByRole("button", { name: t.reload }));
        expect(reload).toHaveBeenCalledOnce();
      }
      if (code === "UNAVAILABLE") {
        fireEvent.click(screen.getByRole("button", { name: t.retry }));
        await waitFor(() => {
          expect(postJsonData).toHaveBeenCalledTimes(2);
        });
        expect(vi.mocked(postJsonData).mock.calls[0]?.[1]).toEqual(
          vi.mocked(postJsonData).mock.calls[1]?.[1],
        );
      }
    },
  );
  it(`M-3 hides self suspension, reactivation and removal in ${locale}`, async () => {
    renderWithIntl(
      <MemberActions companyId={MOCK_COMPANY_A_ID} member={member} own />,
      { locale },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: t.actionsFor.replace("{name}", "Synthetic Member"),
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: t.changeRoles }),
    ).toBeVisible();
    for (const action of ["suspend", "reactivate", "remove"] as MemberAction[])
      expect(
        screen.queryByRole("menuitem", { name: t[action as "suspend"] }),
      ).not.toBeInTheDocument();
  });
}
