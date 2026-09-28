import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { ownerDetailSchema, propertyDetailSchema } from "../contract";
import ownerFixture from "./fixtures/owner-detail.synthetic.json";
import propertyFixture from "./fixtures/property-detail.synthetic.json";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  updateOwnerAction: vi.fn(),
  putBankDetailsAction: vi.fn(),
  inviteOwnerAction: vi.fn(),
  acceptOwnerDocumentAction: vi.fn(),
  rejectOwnerDocumentAction: vi.fn(),
  acceptPropertyDocumentAction: vi.fn(),
  rejectPropertyDocumentAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("../actions", () => mocks);
import { OwnerForm } from "../components/owner-form";
import { OwnerRecord } from "../components/owner-record";
import { BankDetailsForm } from "../components/bank-details-form";
import { UploadPanel } from "../components/upload-panel";

beforeEach(() => {
  vi.resetAllMocks();
});
describe.each(["en", "ar"] as const)("%s owner commands", (locale) => {
  const t = getMessages(locale).Owners;
  it("AC-3 keeps the invitation email after a refusal and shows pending expiry after success", async () => {
    const owner = ownerDetailSchema.parse(ownerFixture);
    owner.email = null;
    renderWithIntl(
      <OwnerRecord
        owner={owner}
        companyId={MOCK_COMPANY_A_ID}
        manager
        saved={false}
      />,
      { locale },
    );
    await userEvent.click(screen.getByRole("button", { name: t.invite }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        t.inviteCheck.replace("{name}", owner.fullName[locale]),
      ),
    ).toBeVisible();
    await userEvent.type(
      within(dialog).getByLabelText(t.email),
      "synthetic.invitee@example.com",
    );
    mocks.inviteOwnerAction.mockResolvedValueOnce({
      ok: false,
      code: "INVITATION_PENDING",
    });
    await userEvent.click(
      await within(dialog).findByRole("button", { name: t.sendInvitation }),
    );
    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toHaveFocus();
    });
    expect(
      within(dialog).getByText(t.problems.INVITATION_PENDING),
    ).toBeVisible();
    expect(within(dialog).getByLabelText(t.email)).toHaveValue(
      "synthetic.invitee@example.com",
    );
    const expiresAt = "2026-10-05T00:00:00.000Z";
    mocks.inviteOwnerAction.mockResolvedValueOnce({
      ok: true,
      data: {
        invitation: { id: crypto.randomUUID(), status: "pending", expiresAt },
      },
    });
    await userEvent.click(
      await within(dialog).findByRole("button", { name: t.sendInvitation }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(t.invited)).toBeVisible();
    expect(
      screen.getByText(getMessages(locale).Status.invitation.pending),
    ).toBeVisible();
    expect(
      document.querySelector(`time[datetime="${expiresAt}"]`),
    ).toBeVisible();
  });

  it("AC-6 preserves edited names after a version conflict and offers Reload", async () => {
    const owner = ownerDetailSchema.parse(ownerFixture);
    renderWithIntl(
      <OwnerForm
        owner={owner}
        companyId={MOCK_COMPANY_A_ID}
        selfManagedAllowed={false}
      />,
      { locale },
    );
    const name = screen.getByLabelText(t.fullNameEn);
    await userEvent.clear(name);
    await userEvent.type(name, "Synthetic Updated Owner");
    mocks.updateOwnerAction.mockResolvedValue({
      ok: false,
      code: "VERSION_CONFLICT",
    });
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    expect(screen.getByText(t.problems.VERSION_CONFLICT)).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveFocus();
    });
    expect(name).toHaveValue("Synthetic Updated Owner");
    expect(mocks.updateOwnerAction.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: owner.version,
      fullName: { en: "Synthetic Updated Owner" },
    });
    await userEvent.click(screen.getByRole("button", { name: t.reload }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(name).toHaveValue("Synthetic Updated Owner");
  });

  it("records bank details with an isolated IBAN and shows only its last four digits", async () => {
    const owner = ownerDetailSchema.parse(ownerFixture);
    const view = renderWithIntl(
      <BankDetailsForm owner={owner} companyId={MOCK_COMPANY_A_ID} />,
      { locale },
    );
    const iban = "AE070331234567890123456";
    fireEvent.change(screen.getByLabelText(t.bankName), {
      target: { value: "Synthetic Bank" },
    });
    fireEvent.change(screen.getByLabelText(t.accountHolder), {
      target: { value: owner.fullName.en },
    });
    fireEvent.change(screen.getByLabelText(t.iban), {
      target: { value: iban },
    });
    expect(screen.getByLabelText(t.iban)).toHaveAttribute("dir", "ltr");
    mocks.putBankDetailsAction.mockResolvedValue({ ok: true, data: { owner } });
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    expect(mocks.putBankDetailsAction.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: owner.version,
      iban,
    });
    view.unmount();
    owner.bank = {
      bankName: "Synthetic Bank",
      accountHolder: owner.fullName.en,
      ibanLast4: iban.slice(-4),
    };
    renderWithIntl(
      <OwnerRecord
        owner={owner}
        companyId={MOCK_COMPANY_A_ID}
        manager
        saved="bank"
      />,
      { locale },
    );
    expect(screen.getByText(iban.slice(-4))).toBeVisible();
    expect(document.body.textContent).not.toContain(iban);
    expect(screen.getByText(t.bankSaved)).toBeVisible();
  });

  it.each(["owners", "properties"] as const)(
    "AC-4 accepts and rejects %s documents with dates and a rejection reason",
    async (entity) => {
      const version =
        propertyDetailSchema.parse(propertyFixture).documents[0]?.latest;
      if (!version) throw new Error("Missing synthetic document");
      version.reviewStatus = "pending_review";
      version.expiryDate = null;
      const docType = entity === "owners" ? "emirates_id" : "title_deed";
      const copy =
        getMessages(locale)[entity === "owners" ? "Owners" : "Properties"];
      const accept =
        entity === "owners"
          ? mocks.acceptOwnerDocumentAction
          : mocks.acceptPropertyDocumentAction;
      const reject =
        entity === "owners"
          ? mocks.rejectOwnerDocumentAction
          : mocks.rejectPropertyDocumentAction;
      renderWithIntl(
        <UploadPanel
          companyId={MOCK_COMPANY_A_ID}
          recordId={ownerFixture.id}
          entity={entity}
          docType={docType}
          document={{
            documentId: crypto.randomUUID(),
            docType,
            current: null,
            latest: version,
          }}
          onClose={vi.fn()}
        />,
        { locale },
      );
      if (entity === "owners") {
        await userEvent.click(
          screen.getByRole("button", { name: copy.accept }),
        );
        expect(screen.getAllByText(copy.problems.EXPIRY_REQUIRED)).toHaveLength(
          2,
        );
        expect(screen.getByLabelText(copy.expiryDate)).toHaveAttribute(
          "aria-invalid",
          "true",
        );
        await waitFor(() => {
          expect(screen.getByRole("alert")).toHaveFocus();
        });
        expect(accept).not.toHaveBeenCalled();
      }
      await userEvent.click(screen.getByRole("button", { name: copy.reject }));
      expect(screen.getByLabelText(copy.rejectReason)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(reject).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText(copy.expiryDate), {
        target: { value: "2028-01-01" },
      });
      accept.mockResolvedValue({ ok: false, code: "VERSION_CONFLICT" });
      await userEvent.click(screen.getByRole("button", { name: copy.accept }));
      expect(accept.mock.calls[0]?.[1]).toMatchObject({
        expectedVersion: version.version,
        expiryDate: "2028-01-01",
      });
      await userEvent.type(
        screen.getByLabelText(copy.rejectReason),
        "Synthetic illegible document",
      );
      reject.mockResolvedValue({
        ok: true,
        data: {
          version: {
            ...version,
            version: version.version + 1,
            reviewStatus: "rejected",
            rejectReason: "Synthetic illegible document",
          },
        },
      });
      await userEvent.click(screen.getByRole("button", { name: copy.reject }));
      expect(reject.mock.calls[0]?.[1]).toMatchObject({
        reason: "Synthetic illegible document",
      });
      expect(screen.getByText(copy.reviewSaved)).toBeVisible();
    },
  );
});
