import { beforeEach, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { seedTenant, seedVersion } from "../_lib/j3-mock";
import { CreateTenantForm } from "./create-tenant-form";
import { InvitationCard } from "./invitation-card";
import { RejectUploadDialog } from "./reject-upload-dialog";
const actions = vi.hoisted(() => ({
  create: vi.fn(),
  invite: vi.fn(),
  reject: vi.fn(),
}));
vi.mock("../_lib/actions", () => ({
  createTenantAction: actions.create,
  inviteTenantAction: actions.invite,
  rejectUploadAction: actions.reject,
}));
const route = {
  locale: "en",
  companyId: MOCK_COMPANY_A_ID,
  tenantId: "tenant-1",
};
beforeEach(() => vi.clearAllMocks());
it.each(["en", "ar"] as const)(
  "T-1 validates before calling the action and focuses the summary in %s",
  async (locale) => {
    const t = getMessages(locale).Tenants;
    renderWithIntl(<CreateTenantForm route={{ ...route, locale }} />, {
      locale,
    });
    await userEvent.type(screen.getByLabelText(t.create.email), "invalid");
    await userEvent.click(screen.getByRole("button", { name: t.add }));
    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    expect(within(summary).getAllByRole("link")).toHaveLength(2);
    for (const field of ["fullNameEn", "email"] as const) {
      expect(within(summary).getByText(t.create.errors[field])).toBeVisible();
      expect(screen.getAllByText(t.create.errors[field])).toHaveLength(2);
      expect(screen.getByLabelText(t.create[field])).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    }
    expect(actions.create).not.toHaveBeenCalled();
  },
);
it("keeps every input on refusal and starts a fresh command per submit", async () => {
  actions.create.mockImplementation(
    (input: { values: Record<string, string> }) =>
      Promise.resolve({
        ok: false,
        code: "VALIDATION_FAILED",
        fields: ["email"],
        values: input.values,
      }),
  );
  const t = getMessages("en").Tenants;
  renderWithIntl(<CreateTenantForm route={route} />);
  await userEvent.type(
    screen.getByLabelText(t.create.fullNameEn),
    "Synthetic Tenant",
  );
  await userEvent.type(
    screen.getByLabelText(t.create.fullNameAr),
    "مستأجر تجريبي",
  );
  await userEvent.type(
    screen.getByLabelText(t.create.email),
    "synthetic@example.com",
  );
  await userEvent.type(
    screen.getByLabelText(t.create.phoneE164),
    "+971500000001",
  );
  await userEvent.click(screen.getByRole("radio", { name: t.ar }));
  await userEvent.click(screen.getByRole("button", { name: t.add }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  expect(screen.getByLabelText(t.create.email)).toHaveValue(
    "synthetic@example.com",
  );
  expect(screen.getByLabelText(t.create.fullNameEn)).toHaveValue(
    "Synthetic Tenant",
  );
  expect(screen.getByLabelText(t.create.fullNameAr)).toHaveValue(
    "مستأجر تجريبي",
  );
  expect(screen.getByRole("radio", { name: t.ar })).toBeChecked();
  await userEvent.click(await screen.findByRole("button", { name: t.add }));
  expect(actions.create).toHaveBeenCalledTimes(2);
  const calls = actions.create.mock.calls as [{ key: string }][];
  expect(calls[0]?.[0].key).not.toBe(calls[1]?.[0].key);
});
it.each(["en", "ar"] as const)(
  "T-3 renders invitation states in %s",
  (locale) => {
    const t = getMessages(locale).Tenants.invitation;
    const tenant = seedTenant();
    const first = renderWithIntl(
      <InvitationCard route={{ ...route, locale }} tenant={tenant} />,
      { locale },
    );
    expect(screen.getByText(t.notInvited)).toBeVisible();
    expect(screen.getByRole("button", { name: t.send })).toBeVisible();
    first.unmount();
    const second = renderWithIntl(
      <InvitationCard
        route={route}
        tenant={{
          ...tenant,
          invitation: {
            id: "invitation-1",
            status: "pending",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        }}
      />,
      { locale },
    );
    expect(screen.getByText(t.pending)).toBeVisible();
    expect(screen.getByText(t.sent)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: t.send }),
    ).not.toBeInTheDocument();
    expect(document.querySelector("time")?.parentElement?.tagName).toBe("BDI");
    second.unmount();
    renderWithIntl(
      <InvitationCard
        route={route}
        tenant={{ ...tenant, linkedAccount: true }}
      />,
      { locale },
    );
    expect(screen.getByText(t.accepted)).toBeVisible();
    expect(screen.getByText(t.linked)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: t.send }),
    ).not.toBeInTheDocument();
  },
);
it.each(["INVITATION_PENDING", "ALREADY_LINKED"] as const)(
  "T-3 displays %s without exposing an invitation link",
  async (code) => {
    actions.invite.mockResolvedValue({ ok: false, code });
    const t = getMessages("en");
    renderWithIntl(<InvitationCard route={route} tenant={seedTenant()} />);
    await userEvent.click(
      screen.getByRole("button", { name: t.Tenants.invitation.send }),
    );
    expect(
      within(await screen.findByRole("alert")).getByText(
        t.Documents.errors[code],
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: t.Tenants.invitation.send }),
    ).not.toBeInTheDocument();
  },
);
it("T-3 records an invitation and shows Pending with a polite status", async () => {
  actions.invite.mockResolvedValue({
    ok: true,
    invitation: {
      id: "invitation-1",
      status: "pending",
      expiresAt: "2099-01-01T00:00:00Z",
    },
  });
  const t = getMessages("en").Tenants.invitation;
  renderWithIntl(<InvitationCard route={route} tenant={seedTenant()} />);
  await userEvent.click(screen.getByRole("button", { name: t.send }));
  expect(await screen.findByRole("status")).toHaveTextContent(t.recorded);
  expect(screen.getByText(t.pending)).toBeVisible();
  expect(actions.invite).toHaveBeenCalledWith({
    ...route,
    key: expect.any(String) as string,
  });
});
it.each(["en", "ar"] as const)(
  "T-4 sends the rejection reason and optional note in %s",
  async (locale) => {
    actions.reject.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    const t = getMessages(locale).Documents;
    const version = seedVersion();
    const ref = {
      ...route,
      locale,
      documentId: version.documentId,
      versionId: version.id,
    };
    renderWithIntl(<RejectUploadDialog route={ref} />, { locale });
    await userEvent.click(
      screen.getByRole("button", { name: t.rejectUpload.title }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t.rejectUpload.consequence)).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("radio", {
        name: t.rejectUpload.reasons.illegible,
      }),
    );
    const note = within(dialog).getByLabelText(t.rejectUpload.note);
    expect(note).toHaveAttribute("maxlength", "500");
    await userEvent.type(note, "Synthetic unreadable image");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t.rejectUpload.confirm }),
    );
    expect(actions.reject).toHaveBeenCalledWith({
      ...ref,
      key: expect.any(String) as string,
      rejection: { reason: "illegible", note: "Synthetic unreadable image" },
    });
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveFocus(),
    );
    expect(note).toHaveValue("Synthetic unreadable image");
  },
);
