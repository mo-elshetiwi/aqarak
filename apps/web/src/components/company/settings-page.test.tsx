import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANY_A_ID, MOCK_COMPANIES } from "@/lib/api/mock-fixtures";
import SettingsPage from "@/app/[locale]/companies/[companyId]/settings/page";
const { requireCompanyContext, requireSession, getCompany } = vi.hoisted(
  () => ({
    requireCompanyContext: vi.fn(),
    requireSession: vi.fn(),
    getCompany: vi.fn(),
  }),
);
vi.mock("@/lib/session/session", () => ({
  requireCompanyContext,
  requireSession,
}));
vi.mock("@/lib/api", () => ({ getApi: () => ({ getCompany }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));
beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sessionId: "synthetic" });
});
afterEach(cleanup);
it("refuses the settings section before loading company data for a manager", async () => {
  requireCompanyContext.mockResolvedValue({
    ...MOCK_COMPANIES.a,
    staffRoles: ["manager"],
    partyLinks: [],
  });
  renderWithIntl(
    await SettingsPage({
      params: Promise.resolve({ locale: "en", companyId: MOCK_COMPANY_A_ID }),
    }),
  );
  expect(screen.getByText(getMessages("en").States.notPermitted)).toBeVisible();
  expect(getCompany).not.toHaveBeenCalled();
});
it("keeps a page heading when current API permissions refuse the company read", async () => {
  requireCompanyContext.mockResolvedValue({
    ...MOCK_COMPANIES.a,
    staffRoles: ["company_administrator"],
    partyLinks: [],
  });
  getCompany.mockResolvedValue({
    ok: false,
    error: { code: "FORBIDDEN", status: 403 },
  });
  renderWithIntl(
    await SettingsPage({
      params: Promise.resolve({ locale: "en", companyId: MOCK_COMPANY_A_ID }),
    }),
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByText(getMessages("en").States.notPermitted)).toBeVisible();
});
it("offers retry when company loading fails", async () => {
  requireCompanyContext.mockResolvedValue({
    ...MOCK_COMPANIES.a,
    staffRoles: ["company_administrator"],
    partyLinks: [],
  });
  getCompany.mockRejectedValue(new Error("Unavailable"));
  renderWithIntl(
    await SettingsPage({
      params: Promise.resolve({ locale: "ar", companyId: MOCK_COMPANY_A_ID }),
    }),
    { locale: "ar" },
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    getMessages("ar").Company.UNAVAILABLE,
  );
  expect(
    screen.getByRole("button", { name: getMessages("ar").Common.retry }),
  ).toBeVisible();
});
