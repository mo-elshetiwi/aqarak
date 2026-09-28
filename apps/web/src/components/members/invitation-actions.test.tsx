import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { postJsonData } from "@/lib/client/post-json";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import type { Invitation } from "@/lib/api/contract";
import { InvitationCommandForm, InvitationActions } from "./invitation-actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/post-json", () => ({ postJsonData: vi.fn() }));
const invitation: Invitation = {
  id: MOCK_COMPANY_A_ID,
  email: "member@example.com",
  kind: "staff",
  staffRoles: ["manager"],
  targetId: null,
  status: "pending",
  version: 4,
  deliveryStatus: "not_configured",
  createdAt: "2026-09-28T00:00:00Z",
  expiresAt: "2026-10-05T00:00:00Z",
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
for (const locale of ["en", "ar"] as const) {
  const t = getMessages(locale).Members;
  it(`M-1 revoke validates reason, preserves failures and sends expected version in ${locale}`, async () => {
    vi.mocked(postJsonData).mockResolvedValue({
      ok: false,
      code: "VERSION_CONFLICT",
    });
    renderWithIntl(
      <InvitationCommandForm
        companyId={MOCK_COMPANY_A_ID}
        invitation={invitation}
        action="revoke"
        onDone={vi.fn()}
        onReload={vi.fn()}
      />,
      { locale },
    );
    fireEvent.click(screen.getByRole("button", { name: t.revoke }));
    expect(screen.getByText(t.reasonRequired)).toBeVisible();
    expect(postJsonData).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t.reason), {
      target: { value: "Withdraw access" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.revoke }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.VERSION_CONFLICT),
    );
    expect(screen.getByLabelText(t.reason)).toHaveValue("Withdraw access");
    expect(postJsonData).toHaveBeenCalledWith(
      expect.stringContaining("/revoke"),
      expect.objectContaining({
        reason: "Withdraw access",
        expectedVersion: 4,
      }),
      expect.anything(),
      expect.anything(),
    );
  });
  it(`M-4 resend shows a new link once and discards it on close in ${locale}`, async () => {
    vi.mocked(postJsonData).mockResolvedValue({
      ok: true,
      data: {
        invitation,
        inviteUrl: "https://app.example.com/en/invitation#new-link",
      },
    });
    renderWithIntl(
      <InvitationActions
        companyId={MOCK_COMPANY_A_ID}
        invitation={invitation}
      />,
      { locale },
    );
    fireEvent.click(screen.getByRole("button", { name: t.resend }));
    await screen.findByRole("dialog");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t.resend,
      }),
    );
    expect(await screen.findByLabelText(t.link)).toHaveValue(
      "https://app.example.com/en/invitation#new-link",
    );
    expect(screen.getByText(t.once)).toBeVisible();
    expect(postJsonData).toHaveBeenCalledWith(
      expect.stringContaining("/resend"),
      expect.objectContaining({ expectedVersion: 4 }),
      expect.anything(),
      expect.anything(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: getMessages(locale).Common.close }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: t.resend }));
    await screen.findByRole("dialog");
    expect(screen.queryByLabelText(t.link)).not.toBeInTheDocument();
  });
}
