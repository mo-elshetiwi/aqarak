import type { ComponentProps } from "react";
import { screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { MOCK_COMPANIES } from "@/lib/api/mock-fixtures";
import { renderWithIntl } from "@/test/render-with-intl";
import { AppShell } from "@/components/shell/app-shell";
const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => route.pathname,
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/components/system/language-switch", () => ({
  LanguageSwitch: () => null,
}));
vi.mock("@/components/system/theme-switch", () => ({
  ThemeSwitch: () => null,
}));
vi.mock("@/components/shell/sign-out", () => ({ SignOut: () => null }));
for (const locale of ["en", "ar"] as const) {
  it(`${locale} names Contracts on a nested contract page`, () => {
    const context = {
      ...MOCK_COMPANIES.a,
      staffRoles: ["manager" as const],
      partyLinks: [],
    };
    route.pathname = `/companies/${context.companyId}/contracts/60000000-0000-4000-8000-000000000001`;
    renderWithIntl(
      <AppShell
        context={context}
        contexts={[context]}
        locale={locale}
        displayName="Synthetic manager"
        mock={false}
      >
        <p>Synthetic content</p>
      </AppShell>,
      { locale },
    );
    const name = getMessages(locale).Navigation.sections.contracts;
    expect(
      within(screen.getByRole("navigation", { name })).getByText(name),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
}
it("keeps the existing title fallback for an unknown section", () => {
  const context = { ...MOCK_COMPANIES.a, staffRoles: [], partyLinks: [] };
  route.pathname = `/companies/${context.companyId}/unknown/record`;
  renderWithIntl(
    <AppShell
      context={context}
      contexts={[context]}
      locale="en"
      displayName="Synthetic manager"
      mock={false}
    >
      <p>Synthetic content</p>
    </AppShell>,
  );
  expect(
    screen.getByRole("navigation", { name: getMessages("en").Shell.notFound }),
  ).toBeInTheDocument();
});
