import type { ComponentProps, ReactElement } from "react";
import { expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { MOCK_COMPANIES, MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { AppShell } from "@/components/shell/app-shell";
const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => route.pathname,
  Link: function TestLink({
    href,
    children,
    locale: _locale,
    ...props
  }: ComponentProps<"a"> & { locale?: string }): ReactElement {
    return (
      <a href={href} data-locale={_locale} {...props}>
        {children}
      </a>
    );
  },
}));
for (const locale of ["en", "ar"] as const) {
  it.each([
    "tenants/new",
    "tenants/tenant-1",
    "tenants/tenant-1/documents/document/versions/version/review",
    "tenants/tenant-1/documents/document/versions/version/review/check",
    "unknown/tenants",
  ])(`T-5 finds only the company section in ${locale}: %s`, (path) => {
    route.pathname = `/${locale}/companies/${MOCK_COMPANY_A_ID}/${path}`;
    const context = {
      ...MOCK_COMPANIES.a,
      staffRoles: ["manager" as const],
      partyLinks: [],
    };
    renderWithIntl(
      <AppShell
        locale={locale}
        context={context}
        contexts={[context]}
        displayName="Synthetic Manager"
        mock={false}
      >
        <h1>{getMessages(locale).Tenants.title}</h1>
      </AppShell>,
      { locale },
    );
    const title = path.startsWith("tenants/")
      ? getMessages(locale).Navigation.sections.tenants
      : getMessages(locale).Shell.notFound;
    const breadcrumb = within(screen.getByRole("banner")).getByRole(
      "navigation",
      { name: title },
    );
    expect(within(breadcrumb).getByText(title)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
}
