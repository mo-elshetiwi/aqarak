import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_ACCOUNTS, MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { propertyDetailSchema, ownerDetailSchema } from "../contract";
import ownerFixture from "./fixtures/owner-detail.synthetic.json";
import propertyFixture from "./fixtures/property-detail.synthetic.json";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  requireCompanyContext: vi.fn(),
  getCurrentSession: vi.fn(),
  listOwners: vi.fn(),
  getOwner: vi.fn(),
  listProperties: vi.fn(),
  getProperty: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  notFound: () => {
    throw new Error("Not found");
  },
}));
vi.mock("../actions", () => ({}));
vi.mock("@/lib/session/session", () => mocks);
vi.mock("../server/estate-api", () => ({ getEstateApi: () => mocks }));
import OwnersPage from "@/app/[locale]/companies/[companyId]/owners/page";
import OwnerPage from "@/app/[locale]/companies/[companyId]/owners/[ownerId]/page";
import PropertiesPage from "@/app/[locale]/companies/[companyId]/properties/page";
import PropertyPage from "@/app/[locale]/companies/[companyId]/properties/[propertyId]/page";
import OwnerEditPage from "@/app/[locale]/companies/[companyId]/owners/[ownerId]/edit/page";
import BankPage from "@/app/[locale]/companies/[companyId]/owners/[ownerId]/bank-details/page";
import PropertyEditPage from "@/app/[locale]/companies/[companyId]/properties/[propertyId]/edit/page";
import { EstateLoading } from "../components/loading";
import { UnitsTable } from "../components/units";

const pages = [
  ["owners list", OwnersPage, "listOwners", "Owners"],
  ["owner record", OwnerPage, "getOwner", "Owners"],
  ["properties list", PropertiesPage, "listProperties", "Properties"],
  ["property record", PropertyPage, "getProperty", "Properties"],
] as const;
function params(locale: string) {
  return Promise.resolve({
    locale,
    companyId: MOCK_COMPANY_A_ID,
    ownerId: ownerFixture.id,
    propertyId: propertyFixture.id,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCompanyContext.mockResolvedValue(
    MOCK_ACCOUNTS.find((account) => account.handle === "manager-1")
      ?.contexts[0],
  );
  mocks.getCurrentSession.mockResolvedValue({ sessionId: "synthetic-session" });
  mocks.listOwners.mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null },
  });
  mocks.listProperties.mockResolvedValue({
    ok: true,
    value: { items: [], nextCursor: null },
  });
  mocks.getOwner.mockResolvedValue({
    ok: true,
    value: ownerDetailSchema.parse(ownerFixture),
  });
  mocks.getProperty.mockResolvedValue({
    ok: true,
    value: propertyDetailSchema.parse(propertyFixture),
  });
});
describe.each(["en", "ar"] as const)("AC-5 %s page states", (locale) => {
  describe.each(pages)("%s", (_label, Page, method, namespace) => {
    it.each(["UNAVAILABLE", "NOT_FOUND", "FORBIDDEN"] as const)(
      "renders %s distinctly",
      async (code) => {
        mocks[method].mockResolvedValue({
          ok: false,
          error: {
            code,
            status:
              code === "UNAVAILABLE" ? 503 : code === "NOT_FOUND" ? 404 : 403,
          },
        });
        renderWithIntl(
          await Page({
            params: params(locale),
            searchParams: Promise.resolve({}),
          }),
          { locale },
        );
        expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
        const messages = getMessages(locale);
        if (code === "UNAVAILABLE") {
          expect(
            screen.getByText(messages[namespace].problems.UNAVAILABLE),
          ).toBeVisible();
          await userEvent.click(
            screen.getByRole("button", { name: messages.Common.retry }),
          );
          expect(mocks.refresh).toHaveBeenCalledOnce();
        } else {
          expect(
            screen.getByText(
              messages.States[
                code === "NOT_FOUND" ? "notFound" : "notPermitted"
              ],
            ),
          ).toBeVisible();
          expect(
            screen.queryByRole("button", { name: messages.Common.retry }),
          ).not.toBeInTheDocument();
        }
      },
    );
  });
  describe.each([pages[0], pages[2]])(
    "%s empty state",
    (_label, Page, _method, namespace) => {
      it.each([false, true])(
        "distinguishes records from matches with filters=%s",
        async (filtered) => {
          renderWithIntl(
            await Page({
              params: params(locale),
              searchParams: Promise.resolve(
                filtered ? { q: "synthetic-no-match" } : {},
              ),
            }),
            { locale },
          );
          const t = getMessages(locale)[namespace];
          expect(
            screen.getByText(filtered ? t.noMatches : t.empty),
          ).toBeVisible();
          expect(
            screen.queryByText(filtered ? t.empty : t.noMatches),
          ).not.toBeInTheDocument();
        },
      );
    },
  );
  it.each(["owners", "owner", "properties", "property"] as const)(
    "announces a distinct loading skeleton for %s",
    (geometry) => {
      renderWithIntl(<EstateLoading geometry={geometry} />, { locale });
      expect(
        screen.getByRole("status", {
          name: getMessages(locale).Common.loading,
        }),
      ).toBeVisible();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        getMessages(locale).Common.loading,
      );
    },
  );
  it.each([OwnerEditPage, BankPage, PropertyEditPage])(
    "refuses edit pages for an owner account",
    async (Page) => {
      mocks.requireCompanyContext.mockResolvedValue(
        MOCK_ACCOUNTS.find((account) => account.handle === "owner-1")
          ?.contexts[0],
      );
      renderWithIntl(
        await Page({
          params: params(locale),
          searchParams: Promise.resolve({}),
        }),
        { locale },
      );
      expect(
        screen.getByText(getMessages(locale).States.notPermitted),
      ).toBeVisible();
      expect(mocks.getOwner).not.toHaveBeenCalled();
      expect(mocks.getProperty).not.toHaveBeenCalled();
    },
  );
  it.each([
    [OwnerPage, "getOwner", "ownerId"],
    [PropertyPage, "getProperty", "propertyId"],
  ] as const)(
    "renders malformed record ids as not found before API access",
    async (Page, method, field) => {
      const values = await params(locale);
      renderWithIntl(
        await Page({
          params: Promise.resolve({ ...values, [field]: "missing-record" }),
          searchParams: Promise.resolve({}),
        }),
        { locale },
      );
      expect(
        screen.getByText(getMessages(locale).States.notFound),
      ).toBeVisible();
      expect(mocks[method]).not.toHaveBeenCalled();
    },
  );
  it("renders a foreign owner id as not found without fetching it", async () => {
    mocks.requireCompanyContext.mockResolvedValue(
      MOCK_ACCOUNTS.find((account) => account.handle === "owner-1")
        ?.contexts[0],
    );
    renderWithIntl(
      await OwnerPage({
        params: params(locale),
        searchParams: Promise.resolve({}),
      }),
      { locale },
    );
    expect(screen.getByText(getMessages(locale).States.notFound)).toBeVisible();
    expect(mocks.getOwner).not.toHaveBeenCalled();
  });
  it("allows an owner's property read without exposing commands or history", async () => {
    const context = MOCK_ACCOUNTS.find(
      (account) => account.handle === "owner-1",
    )?.contexts[0];
    if (!context) throw new Error("Missing synthetic context");
    const property = propertyDetailSchema.parse(propertyFixture);
    property.owners[0] = {
      id: context.partyLinks[0]?.partyId ?? "",
      fullName: ownerFixture.fullName,
    };
    mocks.requireCompanyContext.mockResolvedValue(context);
    mocks.getProperty.mockResolvedValue({ ok: true, value: property });
    renderWithIntl(
      await PropertyPage({
        params: params(locale),
        searchParams: Promise.resolve({ document: "title_deed" }),
      }),
      { locale },
    );
    expect(
      screen.getByRole("heading", { level: 1, name: property.name[locale] }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: getMessages(locale).Properties.edit }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByText(getMessages(locale).Properties.history),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /201/ }),
    ).not.toBeInTheDocument();
  });
  it("gives an empty unit list its own no-records state", () => {
    renderWithIntl(<UnitsTable units={[]} />, { locale });
    expect(
      screen.getByRole("heading", { name: getMessages(locale).Units.empty }),
    ).toBeVisible();
  });
});
