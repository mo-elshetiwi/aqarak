import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMessages, domainLabel } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { postJsonData } from "@/lib/client/post-json";
import { SessionProvider } from "@/components/shell/session-context";
import { MOCK_COMPANY_A_ID, MOCK_COMPANIES } from "@/lib/api/mock-fixtures";
import { InviteForm, InviteSheet } from "./invite-sheet";
import { MembersView } from "./members-view";
import MembersPage, {
  generateMetadata as membersMetadata,
} from "@/app/[locale]/companies/[companyId]/members/page";
import { generateMetadata as invitationMetadata } from "@/app/[locale]/invitation/page";
const { refresh, requireCompanyContext, listMembers } = vi.hoisted(() => ({
  refresh: vi.fn(),
  requireCompanyContext: vi.fn(),
  listMembers: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  notFound: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock("@/lib/session/session", () => ({
  requireCompanyContext,
  requireSession: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ getApi: () => ({ listMembers }) }));
vi.mock("@/lib/client/post-json", () => ({ postJsonData: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
for (const locale of ["en", "ar"] as const) {
  const m = getMessages(locale).Members;
  it.each(["company_administrator", "manager"] as const)(
    `includes section, company and brand in the %s members title in ${locale}`,
    async (role) => {
      requireCompanyContext.mockResolvedValue({
        ...MOCK_COMPANIES.a,
        staffRoles: [role],
        partyLinks: [],
      });
      const metadata = await membersMetadata({
        params: Promise.resolve({ locale, companyId: MOCK_COMPANY_A_ID }),
      });
      expect(metadata.title).toBe(
        `${role === "manager" ? "Shell.notPermitted · " : ""}Members.title · ${MOCK_COMPANIES.a.companyName[locale]} · Auth.brand`,
      );
    },
  );
  it(`includes section and brand in the invitation title in ${locale}`, async () => {
    expect(
      await invitationMetadata({ params: Promise.resolve({ locale }) }),
    ).toEqual({
      title: "Members.invitationTitle · Auth.brand",
      robots: { index: false, follow: false },
    });
  });
  it(`shows only available member columns in ${locale}`, () => {
    renderWithIntl(
      <MembersView
        accountId={MOCK_COMPANY_A_ID}
        companyId={MOCK_COMPANY_A_ID}
        members={[
          {
            membershipId: MOCK_COMPANY_A_ID,
            accountId: MOCK_COMPANY_A_ID,
            displayName: "Synthetic Member",
            email: "member@example.com",
            staffRoles: ["manager"],
            status: "active",
            version: 1,
          },
        ]}
        invitations={[]}
      />,
      { locale },
    );
    const table = within(screen.getByRole("table", { name: m.title }));
    expect(
      table.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual([m.name, m.email, m.roles, m.status, m.actions]);
    expect(
      within(table.getByRole("row", { name: /Synthetic Member/ })).getAllByRole(
        "cell",
      ),
    ).toHaveLength(4);
  });
  it(`W-3 validates email and roles before transport in ${locale}`, () => {
    renderWithIntl(<InviteForm companyId={MOCK_COMPANY_A_ID} />, { locale });
    fireEvent.change(screen.getByLabelText(m.email), {
      target: { value: "invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: m.send }));
    expect(screen.getByRole("alert")).toHaveTextContent(m.invalidEmail);
    expect(screen.getByRole("alert")).toHaveTextContent(m.roleRequired);
    expect(postJsonData).not.toHaveBeenCalled();
    expect(screen.getByLabelText(m.email)).toHaveValue("invalid");
  });
  it(`W-3 retains command key on retry and shows the one-time link in ${locale}`, async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(postJsonData)
      .mockResolvedValueOnce({ ok: false, code: "INVITATION_EXISTS" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          invitation: {
            id: MOCK_COMPANY_A_ID,
            email: "member@example.com",
            staffRoles: ["manager"],
            status: "pending",
            deliveryStatus: "not_configured",
            expiresAt: "2026-10-05T00:00:00.000Z",
          },
          inviteUrl: "https://app.example.com/en/invitation#synthetic",
        },
      });
    renderWithIntl(
      <SessionProvider csrfToken="csrf">
        <InviteForm companyId={MOCK_COMPANY_A_ID} />
      </SessionProvider>,
      { locale },
    );
    fireEvent.change(screen.getByLabelText(m.email), {
      target: { value: "member@example.com" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: domainLabel(locale, "staffRole", "manager"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: m.send }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(m.INVITATION_EXISTS),
    );
    fireEvent.click(screen.getByRole("button", { name: m.send }));
    await screen.findByLabelText(m.link);
    expect(screen.getByText(m.not_configured)).toBeInTheDocument();
    expect(screen.getByText(m.once)).toBeInTheDocument();
    const first = vi.mocked(postJsonData).mock.calls[0];
    const second = vi.mocked(postJsonData).mock.calls[1];
    expect(first?.[1]).toEqual(second?.[1]);
    expect(first?.[1]).toMatchObject({
      idempotencyKey: expect.any(String) as unknown,
    });
    expect(first?.[3]).toEqual({ csrfToken: "csrf" });
    fireEvent.click(screen.getByRole("button", { name: m.copy }));
    await screen.findByText(m.copied);
    expect(writeText).toHaveBeenCalledWith(
      "https://app.example.com/en/invitation#synthetic",
    );
  });
}
it("W-6 refuses the manager before member data is fetched", async () => {
  requireCompanyContext.mockResolvedValue({
    ...MOCK_COMPANIES.a,
    staffRoles: ["manager"],
    partyLinks: [],
  });
  renderWithIntl(
    await MembersPage({
      params: Promise.resolve({ locale: "en", companyId: MOCK_COMPANY_A_ID }),
    }),
  );
  expect(
    screen.getByText(getMessages("en").States.notPermitted),
  ).toBeInTheDocument();
  expect(listMembers).not.toHaveBeenCalled();
});
it("refreshes on sheet close and returns keyboard focus to its trigger", async () => {
  renderWithIntl(<InviteSheet companyId={MOCK_COMPANY_A_ID} />);
  const trigger = screen.getByRole("button", { name: "Invite member" });
  fireEvent.click(trigger);
  await screen.findByRole("dialog");
  fireEvent.click(
    screen.getByRole("button", { name: getMessages("en").Common.close }),
  );
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => expect(trigger).toHaveFocus());
});
