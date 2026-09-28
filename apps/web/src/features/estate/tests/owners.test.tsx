import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID, MOCK_ACCOUNTS } from "@/lib/api/mock-fixtures";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createOwnerAction: vi.fn(),
  putMandateAction: vi.fn(),
  requireCompanyContext: vi.fn(),
  getCurrentSession: vi.fn(),
  listOwners: vi.fn(),
  getOwner: vi.fn(),
  getProperty: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("../actions", () => ({
  createOwnerAction: mocks.createOwnerAction,
  putMandateAction: mocks.putMandateAction,
}));
vi.mock("@/lib/session/session", () => ({
  requireCompanyContext: mocks.requireCompanyContext,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("../server/estate-api", () => ({
  getEstateApi: () => ({
    listOwners: mocks.listOwners,
    getOwner: mocks.getOwner,
    getProperty: mocks.getProperty,
  }),
}));
import { OwnersList } from "../components/owners-list";
import { OwnerForm } from "../components/owner-form";
import { MandateForm } from "../components/mandate-form";
import { EstateError } from "../components/shared";
import { createEstateMockStore } from "../server/mock-adapter";
import OwnerPage from "@/app/[locale]/companies/[companyId]/owners/[ownerId]/page";
import OwnersPage from "@/app/[locale]/companies/[companyId]/owners/page";
import type { OwnerListItem } from "../contract";
const companyId = MOCK_COMPANY_A_ID;
function ownerFixture() {
  const owner = createEstateMockStore().owners[companyId]?.[0];
  if (!owner) throw new Error("Missing fixture");
  return owner;
}
function listFixture(): OwnerListItem[] {
  return (createEstateMockStore().owners[companyId] ?? []).map((owner) => ({
    ...owner,
    onboarding: owner.onboarding.status,
    managementAgreement: null,
    tawtheeqAuthorisation: null,
  }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProperty.mockResolvedValue({
    ok: false,
    error: { code: "NOT_FOUND", status: 404 },
  });
});
describe.each(["en", "ar"] as const)("%s owners", (locale) => {
  const t = getMessages(locale).Owners;
  it("AC-3 renders bilingual identities and recorded approval without full identity numbers", () => {
    renderWithIntl(
      <OwnersList
        companyId={companyId}
        items={listFixture()}
        query={{}}
        nextCursor={null}
      />,
      { locale },
    );
    for (const owner of listFixture()) {
      expect(screen.getByText(owner.fullName.en)).toBeVisible();
      expect(screen.getByText(owner.fullName.ar)).toBeVisible();
    }
    expect(screen.getByText(t.gate.onChosen)).toBeVisible();
    expect(screen.getByText(t.gate.offChosen)).toBeVisible();
    expect(screen.getAllByText(t.gate.notRecorded)).toHaveLength(2);
    expect(screen.getByRole("table").textContent).not.toMatch(/\d{15}/);
  });
  it("AC-3 distinguishes no records, no matches and unavailable with recovery actions", async () => {
    const view = renderWithIntl(
      <OwnersList
        companyId={companyId}
        items={[]}
        query={{}}
        nextCursor={null}
      />,
      { locale },
    );
    expect(screen.getByText(t.empty)).toBeVisible();
    expect(screen.getByRole("button", { name: t.add })).toBeVisible();
    view.rerender(<div />);
    view.unmount();
    const filtered = renderWithIntl(
      <OwnersList
        companyId={companyId}
        items={[]}
        query={{ q: "none" }}
        nextCursor={null}
      />,
      { locale },
    );
    await userEvent.click(screen.getByRole("button", { name: t.clearFilters }));
    expect(mocks.push).toHaveBeenCalled();
    filtered.unmount();
    renderWithIntl(
      <EstateError problem={{ code: "UNAVAILABLE", status: 503 }} />,
      { locale },
    );
    await userEvent.click(
      screen.getByRole("button", { name: getMessages(locale).Common.retry }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it.each(["tenant-1", "technician-1"])(
    "AC-4 refuses %s before listing owners",
    async (handle) => {
      mocks.requireCompanyContext.mockResolvedValue(
        MOCK_ACCOUNTS.find((a) => a.handle === handle)?.contexts[0],
      );
      const page = await OwnersPage({
        params: Promise.resolve({ locale, companyId }),
        searchParams: Promise.resolve({}),
      });
      renderWithIntl(page, { locale });
      expect(
        screen.getByText(getMessages(locale).States.notPermitted),
      ).toBeVisible();
      expect(mocks.listOwners).not.toHaveBeenCalled();
    },
  );
  it("AC-5 keeps input, focuses matching errors and localizes server refusals", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <OwnerForm companyId={companyId} selfManagedAllowed={false} />,
      { locale },
    );
    await user.type(screen.getByLabelText(t.fullNameEn), "Synthetic Owner");
    await user.type(screen.getByLabelText(t.fullNameAr), "مالك تجريبي");
    await user.type(screen.getByLabelText(t.eidNumber), "12345678901234");
    await user.click(screen.getByRole("button", { name: t.add }));
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getAllByText(t.eidInvalid)).toHaveLength(2);
    expect(screen.getByLabelText(t.eidNumber)).toHaveValue("12345678901234");
    expect(mocks.createOwnerAction).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(t.eidNumber), "5");
    mocks.createOwnerAction.mockResolvedValue({
      ok: false,
      code: "SELF_MANAGED_NOT_ALLOWED",
    });
    await user.click(screen.getByRole("button", { name: t.add }));
    expect(
      await screen.findByText(t.problems.SELF_MANAGED_NOT_ALLOWED),
    ).toBeVisible();
    const key = mocks.createOwnerAction.mock.calls[0]?.[0] as {
      idempotencyKey: string;
    };
    expect(key.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
    await user.click(await screen.findByRole("button", { name: t.add }));
    expect(mocks.createOwnerAction.mock.calls[1]?.[0]).toEqual(key);
  });
  it("AC-6 confirms the off effect and converts grouped AED exactly, requiring a change reason", async () => {
    const user = userEvent.setup();
    const owner = ownerFixture();
    renderWithIntl(<MandateForm companyId={companyId} owner={owner} />, {
      locale,
    });
    await user.click(screen.getByLabelText(t.gateOff));
    await user.clear(screen.getByLabelText(t.costThresholdAed));
    await user.type(screen.getByLabelText(t.costThresholdAed), "2,000");
    await user.click(screen.getByRole("button", { name: t.continue }));
    expect(screen.getAllByText(t.problems.REASON_REQUIRED)).toHaveLength(2);
    expect(screen.getByLabelText(t.reason)).toBeRequired();
    expect(mocks.putMandateAction).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText(t.reason),
      "Synthetic owner decision",
    );
    await user.click(screen.getByRole("button", { name: t.continue }));
    expect(screen.getByText(t.effectOff)).toBeVisible();
    mocks.putMandateAction.mockResolvedValue({
      ok: false,
      code: "VERSION_CONFLICT",
    });
    await user.click(screen.getByRole("button", { name: t.saveMandate }));
    await waitFor(() => {
      expect(mocks.putMandateAction).toHaveBeenCalledOnce();
    });
    expect(mocks.putMandateAction.mock.calls[0]?.[1]).toMatchObject({
      costThresholdFils: "200000",
      ownerGate: false,
      expectedVersion: 1,
    });
    expect(screen.getByText(t.problems.VERSION_CONFLICT)).toBeVisible();
    expect(screen.getByRole("button", { name: t.reload })).toBeVisible();
    await user.click(screen.getByRole("button", { name: t.change }));
    expect(screen.getByLabelText(t.costThresholdAed)).toHaveValue("2,000");
  });
  it("blocks duplicate submissions while a command is pending", async () => {
    let finish: ((v: { ok: false; code: string }) => void) | undefined;
    mocks.createOwnerAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderWithIntl(<OwnerForm companyId={companyId} selfManagedAllowed />, {
      locale,
    });
    fireEvent.change(screen.getByLabelText(t.fullNameEn), {
      target: { value: "Synthetic Owner" },
    });
    fireEvent.change(screen.getByLabelText(t.fullNameAr), {
      target: { value: "مالك تجريبي" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.add }));
    expect(screen.getByRole("button", { name: t.saving })).toBeDisabled();
    const form = screen.getByLabelText(t.fullNameEn).closest("form");
    if (!form) throw new Error("Missing form");
    fireEvent.submit(form);
    expect(mocks.createOwnerAction).toHaveBeenCalledOnce();
    finish?.({ ok: false, code: "UNAVAILABLE" });
    await waitFor(() => {
      expect(within(form).getByRole("button", { name: t.add })).toBeEnabled();
    });
  });
});

describe.each(["en", "ar"] as const)("%s owner access boundaries", (locale) => {
  it("renders only the linked owner's record without actions or history", async () => {
    const owner = ownerFixture();
    owner.history = [
      {
        eventType: "mandate_recorded",
        occurredAt: "2026-09-28T00:00:00.000Z",
        actorDisplayName: "Synthetic manager",
        actorRole: "manager",
        channel: "web_form",
        reason: "Synthetic reason",
      },
    ];
    mocks.requireCompanyContext.mockResolvedValue(
      MOCK_ACCOUNTS.find((a) => a.handle === "owner-1")?.contexts[0],
    );
    mocks.getCurrentSession.mockResolvedValue({
      sessionId: "synthetic-session",
    });
    mocks.getOwner.mockResolvedValue({ ok: true, value: owner });
    const page = await OwnerPage({
      params: Promise.resolve({ locale, companyId, ownerId: owner.id }),
      searchParams: Promise.resolve({}),
    });
    expect(page).toMatchObject({ props: { owner: { history: [] } } });
    renderWithIntl(page, { locale });
    const t = getMessages(locale).Owners;
    expect(
      screen.getByRole("heading", { level: 1, name: owner.fullName[locale] }),
    ).toBeVisible();
    expect(screen.queryByText(t.history)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t.upload }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: t.editMandate }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic reason")).not.toBeInTheDocument();
  });
  it("does not request another owner's record for an owner party link", async () => {
    mocks.requireCompanyContext.mockResolvedValue(
      MOCK_ACCOUNTS.find((a) => a.handle === "owner-1")?.contexts[0],
    );
    renderWithIntl(
      await OwnerPage({
        params: Promise.resolve({
          locale,
          companyId,
          ownerId: crypto.randomUUID(),
        }),
        searchParams: Promise.resolve({}),
      }),
      { locale },
    );
    expect(screen.getByText(getMessages(locale).States.notFound)).toBeVisible();
    expect(mocks.getOwner).not.toHaveBeenCalled();
  });
});
