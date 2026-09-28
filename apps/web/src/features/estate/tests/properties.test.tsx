import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getDirection, getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID, MOCK_ACCOUNTS } from "@/lib/api/mock-fixtures";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  createPropertyAction: vi.fn(),
  createUnitsAction: vi.fn(),
  requestOwnerUploadAction: vi.fn(),
  requestPropertyUploadAction: vi.fn(),
  checkOwnerDocumentAction: vi.fn(),
  checkPropertyDocumentAction: vi.fn(),
  acceptOwnerDocumentAction: vi.fn(),
  acceptPropertyDocumentAction: vi.fn(),
  rejectOwnerDocumentAction: vi.fn(),
  rejectPropertyDocumentAction: vi.fn(),
  requireCompanyContext: vi.fn(),
  getCurrentSession: vi.fn(),
  listProperties: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("../actions", () => mocks);
vi.mock("@/lib/session/session", () => ({
  requireCompanyContext: mocks.requireCompanyContext,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("../server/estate-api", () => ({
  getEstateApi: () => ({ listProperties: mocks.listProperties }),
}));
import { PropertyRecord } from "../components/property-record";
import { PropertyForm } from "../components/property-form";
import { UnitsForm } from "../components/units";
import { UploadContent } from "../components/upload-panel";
import { createEstateMockStore } from "../server/mock-adapter";
import PropertiesPage from "@/app/[locale]/companies/[companyId]/properties/page";
import type { VersionItem } from "../contract";
const companyId = MOCK_COMPANY_A_ID;
const recordId = "60000000-0000-4000-8000-000000000001";
const documentId = "60000000-0000-4000-8000-000000000002";
const versionId = "60000000-0000-4000-8000-000000000003";
function cleanVersion(): VersionItem {
  return {
    versionId,
    version: 2,
    versionNo: 1,
    processingStatus: "scan_clean",
    reviewStatus: "pending_review",
    issueDate: null,
    expiryDate: null,
    validity: null,
    rejectReason: null,
    scanResult: null,
  };
}
function propertyFixture() {
  const property = createEstateMockStore().properties[companyId]?.[0];
  if (!property) throw new Error("Missing fixture");
  return property;
}
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe.each(["en", "ar"] as const)("%s properties and uploads", (locale) => {
  const t = getMessages(locale).Properties;
  const u = getMessages(locale).Units;
  it.each(["tenant-1", "technician-1"])(
    "AC-4 refuses %s before listing properties",
    async (handle) => {
      mocks.requireCompanyContext.mockResolvedValue(
        MOCK_ACCOUNTS.find((a) => a.handle === handle)?.contexts[0],
      );
      renderWithIntl(
        await PropertiesPage({
          params: Promise.resolve({ locale, companyId }),
          searchParams: Promise.resolve({}),
        }),
        { locale },
      );
      expect(
        screen.getByText(getMessages(locale).States.notPermitted),
      ).toBeVisible();
      expect(mocks.listProperties).not.toHaveBeenCalled();
    },
  );
  it("AC-7 rejects oversized and unsupported documents before requesting upload", () => {
    renderWithIntl(
      <UploadContent
        companyId={companyId}
        recordId={recordId}
        entity="properties"
        docType="title_deed"
        onClose={vi.fn()}
      />,
      { locale },
    );
    const large = new File(
      [new Uint8Array(25 * 1024 * 1024)],
      "synthetic.png",
      { type: "image/png" },
    );
    fireEvent.change(screen.getByLabelText(t.chooseFile), {
      target: { files: [large] },
    });
    expect(screen.getAllByText(t.problems.UPLOAD_TOO_LARGE)).toHaveLength(2);
    const wrong = new File(["synthetic"], "synthetic.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByLabelText(t.chooseFile), {
      target: { files: [wrong] },
    });
    expect(screen.getAllByText(t.problems.UNSUPPORTED_TYPE)).toHaveLength(2);
    expect(mocks.requestPropertyUploadAction).not.toHaveBeenCalled();
  });
  it("AC-7 hashes a PNG and sends the bytes with exactly the signed headers before checking", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    const digest = vi.fn().mockResolvedValue(new Uint8Array(32).buffer);
    vi.stubGlobal("crypto", {
      randomUUID: crypto.randomUUID.bind(crypto),
      subtle: { digest },
    });
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", transport);
    const headers = {
      "Content-Type": "image/png",
      "x-amz-checksum-sha256": `${"A".repeat(43)}=`,
    };
    mocks.requestPropertyUploadAction.mockResolvedValue({
      ok: true,
      data: {
        documentId,
        documentVersionId: versionId,
        versionNo: 1,
        upload: {
          url: "https://storage.example.com/synthetic",
          method: "PUT",
          headers,
          expiresAt: "2026-09-28T12:00:00.000Z",
        },
      },
    });
    mocks.checkPropertyDocumentAction.mockResolvedValue({
      ok: true,
      data: { version: cleanVersion(), scanPending: false },
    });
    renderWithIntl(
      <UploadContent
        companyId={companyId}
        recordId={recordId}
        entity="properties"
        docType="title_deed"
        onClose={vi.fn()}
      />,
      { locale },
    );
    const file = new File([bytes], "synthetic.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(bytes),
    });
    fireEvent.change(screen.getByLabelText(t.chooseFile), {
      target: { files: [file] },
    });
    await userEvent.click(screen.getByRole("button", { name: t.upload }));
    await waitFor(() => {
      expect(mocks.checkPropertyDocumentAction).toHaveBeenCalledOnce();
    });
    expect(digest).toHaveBeenCalledWith("SHA-256", bytes);
    expect(mocks.requestPropertyUploadAction.mock.calls[0]?.[1]).toEqual({
      docType: "title_deed",
      contentType: "image/png",
      byteSize: 4,
      sha256: "0".repeat(64),
    });
    expect(transport).toHaveBeenCalledWith(
      "https://storage.example.com/synthetic",
      { method: "PUT", headers, body: bytes },
    );
    expect(transport.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.checkPropertyDocumentAction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(screen.getByText(t.ready)).toBeVisible();
    expect(document.body.textContent).not.toContain(
      "https://storage.example.com",
    );
  });
  it("AC-8 filters attention statuses and inherits direction while isolating identifiers", async () => {
    const property = propertyFixture();
    renderWithIntl(
      <div dir={getDirection(locale)}>
        <PropertyRecord companyId={companyId} property={property} />
      </div>,
      { locale },
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    await userEvent.click(
      screen.getByRole("button", { name: u.filters.attention }),
    );
    const attention = property.units.filter((unit) =>
      ["reserved", "notice_given", "under_maintenance", "blocked"].includes(
        unit.status,
      ),
    );
    expect(within(table).getAllByRole("row")).toHaveLength(
      attention.length + 1,
    );
    for (const unit of attention)
      expect(within(table).getByText(unit.unitNo)).toBeVisible();
    expect(
      within(table).queryByText(getMessages(locale).Status.unit.vacant),
    ).not.toBeInTheDocument();
    expect(table.closest(`[dir="${getDirection(locale)}"]`)).not.toBeNull();
    expect(table.querySelectorAll('bdi[dir="ltr"]').length).toBeGreaterThan(0);
    expect(
      screen.getByText(locale === "en" ? "6 units" : /[6٦] وحدات/),
    ).toBeVisible();
  });
  it("AC-9 maps a duplicate unit number to the second row and summary link", async () => {
    const user = userEvent.setup();
    mocks.createUnitsAction.mockResolvedValue({
      ok: false,
      code: "UNIT_NUMBER_TAKEN",
      field: "units[1].unitNo",
    });
    renderWithIntl(<UnitsForm companyId={companyId} propertyId={recordId} />, {
      locale,
    });
    await user.type(screen.getByLabelText(u.unitNo), "201");
    await user.click(screen.getByRole("button", { name: u.addRow }));
    const fields = screen.getAllByLabelText(u.unitNo);
    const second = fields[1];
    if (!second) throw new Error("Missing row");
    await user.type(second, "202");
    await user.click(screen.getByRole("button", { name: u.submit }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveFocus();
    });
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(second).toHaveValue("202");
    expect(screen.getAllByText(u.problems.UNIT_NUMBER_TAKEN)).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: u.problems.UNIT_NUMBER_TAKEN }),
    ).toHaveAttribute("href", "#units[1].unitNo");
  });
  it("creates a bilingual property with a mandate-following choice and opens the title deed panel", async () => {
    const store = createEstateMockStore();
    const owner = store.owners[companyId]?.[0];
    if (!owner) throw new Error("Missing owner");
    const owners = [
      {
        ...owner,
        onboarding: owner.onboarding.status,
        managementAgreement: null,
        tawtheeqAuthorisation: null,
      },
    ];
    mocks.createPropertyAction.mockResolvedValue({
      ok: true,
      data: {
        property: {
          id: recordId,
          version: 1,
          name: { en: "Synthetic Building", ar: "مبنى تجريبي" },
        },
      },
    });
    renderWithIntl(<PropertyForm companyId={companyId} owners={owners} />, {
      locale,
    });
    fireEvent.change(screen.getByLabelText(t.fullNameEn), {
      target: { value: "Synthetic Building" },
    });
    fireEvent.change(screen.getByLabelText(t.fullNameAr), {
      target: { value: "مبنى تجريبي" },
    });
    fireEvent.change(screen.getByLabelText(t.owner), {
      target: { value: owner.id },
    });
    await userEvent.click(screen.getByRole("button", { name: t.add }));
    expect(mocks.createPropertyAction.mock.calls[0]?.[1]).toMatchObject({
      ownerId: owner.id,
      ownerGateOverride: null,
    });
    expect(mocks.push).toHaveBeenCalledWith(
      `/${locale}/companies/${companyId}/properties/${recordId}?document=title_deed`,
    );
  });
  it("requires identity expiry before review commands", async () => {
    const version = cleanVersion();
    const ownerT = getMessages(locale).Owners;
    renderWithIntl(
      <UploadContent
        companyId={companyId}
        recordId={recordId}
        entity="owners"
        docType="emirates_id"
        document={{
          documentId,
          docType: "emirates_id",
          current: null,
          latest: version,
        }}
        onClose={vi.fn()}
      />,
      { locale },
    );
    await userEvent.click(screen.getByRole("button", { name: ownerT.accept }));
    expect(screen.getAllByText(ownerT.problems.EXPIRY_REQUIRED)).toHaveLength(
      2,
    );
    expect(mocks.acceptOwnerDocumentAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(ownerT.expiryDate), {
      target: { value: "2028-01-01" },
    });
    mocks.acceptOwnerDocumentAction.mockResolvedValue({
      ok: true,
      data: { version: { ...version, version: 3, reviewStatus: "accepted" } },
    });
    await userEvent.click(screen.getByRole("button", { name: ownerT.accept }));
    expect(mocks.acceptOwnerDocumentAction.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: 2,
      expiryDate: "2028-01-01",
    });
  });
});
