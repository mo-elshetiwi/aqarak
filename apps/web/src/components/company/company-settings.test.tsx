import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { postJsonData } from "@/lib/client/post-json";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import type { Company } from "@/lib/api/contract";
import { CompanySettings } from "./company-settings";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/client/post-json", () => ({ postJsonData: vi.fn() }));
const company: Company = {
  id: MOCK_COMPANY_A_ID,
  kind: "management_company",
  name: { en: "Company name", ar: "اسم الشركة" },
  tradeLicenceNumber: "LICENCE",
  trn: null,
  defaultOwnerGate: true,
  isDemo: false,
  status: "active",
  version: 3,
};
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
for (const locale of ["en", "ar"] as const) {
  const t = getMessages(locale).Company;
  it(`M-5 validates names, management licence and TRN in ${locale}`, async () => {
    renderWithIntl(<CompanySettings company={company} />, { locale });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(t.ownerApprovalDescription)).toBeVisible();
    fireEvent.change(screen.getByLabelText(t.nameEn), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByLabelText(t.nameAr), {
      target: { value: " " },
    });
    fireEvent.change(screen.getByLabelText(t.licence), {
      target: { value: " " },
    });
    fireEvent.change(screen.getByLabelText(t.trn), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.invalidName),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(t.invalidLicence);
    expect(screen.getByRole("alert")).toHaveTextContent(t.invalidTrn);
    expect(postJsonData).not.toHaveBeenCalled();
  });
  it(`M-5 preserves inputs and offers reload on conflict, then confirms a versioned save in ${locale}`, async () => {
    vi.mocked(postJsonData)
      .mockResolvedValueOnce({ ok: false, code: "VERSION_CONFLICT" })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } });
    renderWithIntl(<CompanySettings company={company} />, { locale });
    fireEvent.change(screen.getByLabelText(t.nameEn), {
      target: { value: "Changed company" },
    });
    fireEvent.change(screen.getByLabelText(t.trn), {
      target: { value: "123456789012345" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.VERSION_CONFLICT),
    );
    expect(screen.getByLabelText(t.nameEn)).toHaveValue("Changed company");
    expect(screen.getByRole("button", { name: t.reload })).toBeVisible();
    expect(postJsonData).toHaveBeenLastCalledWith(
      `/api/companies/${company.id}`,
      expect.objectContaining({
        expectedVersion: 3,
        name: { en: "Changed company", ar: company.name.ar },
        trn: "123456789012345",
      }),
      expect.anything(),
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.saved)).toHaveAttribute("role", "status");
    expect(refresh).toHaveBeenCalledOnce();
  });
  it(`allows an empty licence for a self-managed owner and retries load failures in ${locale}`, async () => {
    vi.mocked(postJsonData).mockResolvedValue({ ok: true, data: { ok: true } });
    renderWithIntl(
      <CompanySettings
        company={{
          ...company,
          kind: "self_managed_owner",
          tradeLicenceNumber: null,
        }}
      />,
      { locale },
    );
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    expect(postJsonData).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ tradeLicenceNumber: null, trn: null }),
      expect.anything(),
      expect.anything(),
    );
    cleanup();
    renderWithIntl(<CompanySettings company={null} />, { locale });
    expect(screen.getByRole("alert")).toHaveTextContent(t.UNAVAILABLE);
    fireEvent.click(
      screen.getByRole("button", { name: getMessages(locale).Common.retry }),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });
}
