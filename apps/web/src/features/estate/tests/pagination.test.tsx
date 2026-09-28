import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { cursorHistory, pageLink } from "../pagination";
import { OwnersList } from "../components/owners-list";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe.each(["en", "ar"] as const)("%s owner pagination", (locale) => {
  it("preserves opaque cursor stacks and API filters without decoding cursors", () => {
    const query = {
      gate: "off",
      onboarding: "incomplete",
      mandateExpiring: "true",
      cursor: "opaque+/=?",
    } as const;
    renderWithIntl(
      <OwnersList
        items={[]}
        companyId={MOCK_COMPANY_A_ID}
        query={query}
        nextCursor="next+/=?"
        previous={["", "prior+/=?"]}
      />,
      { locale },
    );
    const t = getMessages(locale).Owners;
    const next = new URL(
      screen.getByRole("link", { name: t.next }).getAttribute("href") ?? "",
      "https://example.com",
    );
    expect(next.searchParams.get("cursor")).toBe("next+/=?");
    expect(next.searchParams.getAll("previous")).toEqual([
      "",
      "prior+/=?",
      "opaque+/=?",
    ]);
    expect(next.searchParams.get("gate")).toBe("off");
    expect(next.searchParams.get("onboarding")).toBe("incomplete");
    expect(next.searchParams.get("mandateExpiring")).toBe("true");
    expect(
      screen.getByRole("checkbox", { name: t.mandateExpiring }),
    ).toBeChecked();
    const previous = new URL(
      screen.getByRole("link", { name: t.previous }).getAttribute("href") ?? "",
      "https://example.com",
    );
    expect(previous.searchParams.get("cursor")).toBe("prior+/=?");
    expect(previous.searchParams.getAll("previous")).toEqual([""]);
  });
});
it("returns to the first page without inventing a cursor", () => {
  expect(pageLink("/owners", { cursor: "opaque" }, "", [])).toBe("/owners");
  expect(cursorHistory(["", "opaque"])).toEqual(["", "opaque"]);
});
