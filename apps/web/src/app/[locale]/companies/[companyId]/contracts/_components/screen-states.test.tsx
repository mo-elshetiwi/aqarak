import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { ContractsList } from "./contracts-list";
import { LoadProblem } from "./load-problem";
import Loading from "../loading";
import { company } from "../_lib/test-fixtures";
const calls = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => calls }));
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Contract screen states", () => {
  for (const locale of ["en", "ar"] as const) {
    const m = getMessages(locale);
    it(`${locale} offers a single clear action when no contract matches the filter`, async () => {
      renderWithIntl(
        <ContractsList
          items={[]}
          nextCursor={null}
          canDraft
          locale={locale}
          companyId={company}
          status="cancelled"
        />,
        { locale },
      );
      expect(screen.getByText(m.Contracts.noMatches)).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getAllByRole("button")).toHaveLength(1);
      await userEvent.click(
        screen.getByRole("button", { name: m.Contracts.clearFilter }),
      );
      expect(calls.push).toHaveBeenCalledWith(
        `/${locale}/companies/${company}/contracts`,
      );
    });
    it(`${locale} uses the same not-found state for concealed and missing records`, () => {
      renderWithIntl(
        <LoadProblem problem={{ status: 404, code: "NOT_FOUND" }} />,
        { locale },
      );
      expect(screen.getByText(m.States.notFound)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    it(`${locale} shows not-permitted without a retry`, () => {
      renderWithIntl(
        <LoadProblem problem={{ status: 403, code: "FORBIDDEN" }} />,
        { locale },
      );
      expect(screen.getByText(m.States.notPermitted)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
    it(`${locale} retries load failures`, async () => {
      renderWithIntl(
        <LoadProblem problem={{ status: 503, code: "UNAVAILABLE" }} />,
        { locale },
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        m.Contracts.loadError,
      );
      await userEvent.click(
        screen.getByRole("button", { name: m.Common.retry }),
      );
      expect(calls.refresh).toHaveBeenCalledTimes(1);
    });
    it(`${locale} announces a skeleton while loading`, () => {
      renderWithIntl(<Loading />, { locale });
      expect(
        screen.getByRole("status", { name: m.Common.loading }),
      ).toBeInTheDocument();
    });
  }
  it("routes a selected status without carrying a previous cursor", () => {
    renderWithIntl(
      <ContractsList
        items={[]}
        nextCursor={"opaque"}
        canDraft={false}
        locale="en"
        companyId={company}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter by status" }),
      { target: { value: "draft" } },
    );
    expect(calls.push).toHaveBeenCalledWith(
      `/en/companies/${company}/contracts?status=draft`,
    );
  });
  it("keeps the filter when moving to the next page", () => {
    renderWithIntl(
      <ContractsList
        items={[]}
        nextCursor={"opaque"}
        canDraft={false}
        locale="en"
        companyId={company}
        status="draft"
      />,
    );
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      `/en/companies/${company}/contracts?cursor=opaque&status=draft`,
    );
  });
});
