import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { InvitationView } from "./invitation-view";
import { PendingInvitationNotice } from "./pending-notice";
import {
  PENDING_INVITATION_KEY,
  capturePendingInvitation,
  readPendingInvitation,
} from "./pending-invitation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SessionProvider } from "@/components/shell/session-context";
import {
  postJsonData,
  postJson,
  navigateDocument,
} from "@/lib/client/post-json";
import { MOCK_ONLY_PASSWORD } from "@/lib/api/mock-fixtures";
const token = "a".repeat(43);
const invitation = {
  companyName: { en: "Example Properties", ar: "عقارات تجريبية" },
  companyKind: "management_company",
  kind: "staff",
  staffRoles: ["manager"],
  maskedEmail: "m***@example.com",
  expiresAt: "2026-10-05T00:00:00.000Z",
  status: "pending",
};
vi.mock("@/lib/client/post-json", () => ({
  postJsonData: vi.fn(),
  postJson: vi.fn(),
  navigateDocument: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/invitation");
  vi.mocked(postJsonData).mockResolvedValue({ ok: true, data: { invitation } });
});
afterEach(cleanup);
for (const locale of ["en", "ar"] as const) {
  const m = getMessages(locale).Members;
  it(`W-4 removes the fragment, persists the token and previews in ${locale}`, async () => {
    window.history.replaceState(null, "", `/${locale}/invitation#${token}`);
    renderWithIntl(<InvitationView signedIn={false} />, { locale });
    await screen.findByRole("heading", {
      name: invitation.companyName[locale],
    });
    expect(window.location.hash).toBe("");
    expect(
      JSON.parse(sessionStorage.getItem(PENDING_INVITATION_KEY) ?? "null"),
    ).toEqual({ token, locale });
    expect(postJsonData).toHaveBeenCalledWith(
      "/api/invitations/preview",
      { token },
      expect.anything(),
    );
    expect(
      screen.getByRole("link", { name: m.signInToAccept }),
    ).toHaveAttribute("href", `/${locale}/sign-in?next=/${locale}/invitation`);
    expect(screen.getByRole("link", { name: m.createAccount })).toHaveAttribute(
      "href",
      `/${locale}/sign-up`,
    );
  });
  it(`W-5 returns sign-in to the pending invitation in ${locale}`, async () => {
    sessionStorage.setItem(
      PENDING_INVITATION_KEY,
      JSON.stringify({ token, locale }),
    );
    vi.mocked(postJson).mockResolvedValue({
      ok: true,
      redirectTo: `/${locale}/setup/company`,
    });
    renderWithIntl(<SignInForm />, { locale });
    fireEvent.change(document.getElementById("email") as HTMLInputElement, {
      target: { value: "member@example.com" },
    });
    fireEvent.change(document.getElementById("password") as HTMLInputElement, {
      target: { value: MOCK_ONLY_PASSWORD },
    });
    fireEvent.click(
      screen.getByRole("button", { name: getMessages(locale).Auth.signIn }),
    );
    await waitFor(() => {
      expect(navigateDocument).toHaveBeenCalledWith(`/${locale}/invitation`);
    });
  });
  it.each(["expired", "accepted", "revoked"] as const)(
    `renders %s invitation status in ${locale}`,
    async (status) => {
      sessionStorage.setItem(
        PENDING_INVITATION_KEY,
        JSON.stringify({ token, locale }),
      );
      vi.mocked(postJsonData).mockResolvedValue({
        ok: true,
        data: { invitation: { ...invitation, status } },
      });
      renderWithIntl(<InvitationView signedIn />, { locale });
      await screen.findByText(m[status]);
      expect(
        screen.queryByRole("button", { name: m.accept }),
      ).not.toBeInTheDocument();
    },
  );
  it.each([
    "INVITATION_EMAIL_MISMATCH",
    "ACTIVE_MEMBERSHIP_ELSEWHERE",
    "INVITATION_NOT_PENDING",
    "PARTY_ALREADY_LINKED",
    "SESSION_INVALID",
    "FORBIDDEN",
    "UNAVAILABLE",
  ] as const)(`renders refusal %s in ${locale}`, async (code) => {
    sessionStorage.setItem(
      PENDING_INVITATION_KEY,
      JSON.stringify({ token, locale }),
    );
    vi.mocked(postJson).mockResolvedValue({ ok: false, code });
    renderWithIntl(
      <SessionProvider csrfToken="csrf">
        <InvitationView signedIn />
      </SessionProvider>,
      { locale },
    );
    fireEvent.click(await screen.findByRole("button", { name: m.accept }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        m[code].replace("{email}", invitation.maskedEmail),
      ),
    );
    expect(readPendingInvitation(locale)).toEqual({ token, locale });
    expect(screen.getByRole("button", { name: m.signOut })).toBeInTheDocument();
  });
}
it("clears the token only after successful acceptance and reuses the key on retry", async () => {
  sessionStorage.setItem(
    PENDING_INVITATION_KEY,
    JSON.stringify({ token, locale: "en" }),
  );
  vi.mocked(postJson)
    .mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" })
    .mockResolvedValueOnce({
      ok: true,
      redirectTo: "/en/companies/company/home",
    });
  renderWithIntl(<InvitationView signedIn />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Accept invitation" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  await waitFor(() => {
    expect(navigateDocument).toHaveBeenCalledWith("/en/companies/company/home");
  });
  expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
  expect(vi.mocked(postJson).mock.calls[0]?.[1]).toEqual(
    vi.mocked(postJson).mock.calls[1]?.[1],
  );
});
it.each(["missing", "unknown", "malformed"])(
  "shows not found for a %s invitation",
  async (kind) => {
    if (kind !== "missing")
      window.history.replaceState(
        null,
        "",
        `/en/invitation#${kind === "malformed" ? "bad" : token}`,
      );
    vi.mocked(postJsonData).mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    renderWithIntl(<InvitationView signedIn={false} />);
    await screen.findByText(getMessages("en").States.notFound);
    expect(window.location.hash).toBe("");
  },
);
it("renders a retryable preview failure", async () => {
  sessionStorage.setItem(
    PENDING_INVITATION_KEY,
    JSON.stringify({ token, locale: "en" }),
  );
  vi.mocked(postJsonData)
    .mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" })
    .mockResolvedValueOnce({ ok: true, data: { invitation } });
  renderWithIntl(<InvitationView signedIn={false} />);
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: getMessages("en").Common.retry }),
  );
  await screen.findByRole("heading", { name: invitation.companyName.en });
});
it("isolates pending invitations by locale and tolerates malformed storage", () => {
  sessionStorage.setItem(PENDING_INVITATION_KEY, "{");
  expect(readPendingInvitation("en")).toBeNull();
  sessionStorage.setItem(
    PENDING_INVITATION_KEY,
    JSON.stringify({ token, locale: "ar" }),
  );
  expect(readPendingInvitation("en")).toBeNull();
  expect(capturePendingInvitation("ar")).toEqual({
    token,
    storageUnavailable: false,
  });
});
it("shows a setup notice only when this locale has a pending invitation", () => {
  sessionStorage.setItem(
    PENDING_INVITATION_KEY,
    JSON.stringify({ token, locale: "en" }),
  );
  renderWithIntl(<PendingInvitationNotice />);
  expect(
    screen.getByRole("link", {
      name: getMessages("en").Auth.pendingInvitation,
    }),
  ).toHaveAttribute("href", "/en/invitation");
});
