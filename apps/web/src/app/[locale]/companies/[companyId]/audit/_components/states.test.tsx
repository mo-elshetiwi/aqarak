import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, type Locale } from "@aqarak/i18n";
import type { ReactElement } from "react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../_actions", () => ({ auditAction: vi.fn() }));
import { AuditError, AuditFailure, AuditNotPermitted } from "./states";
import { AuditTrail } from "./trail";
import Loading from "../loading";
function view(child: ReactElement, locale: Locale): void {
  render(
    <NextIntlClientProvider locale={locale} messages={getMessages(locale)}>
      {child}
    </NextIntlClientProvider>,
  );
}
for (const locale of ["en", "ar"] as const)
  describe(`audit states ${locale}`, () => {
    const t = getMessages(locale).Audit;
    it("shows distinct loading and could-not-load states", () => {
      view(
        <>
          <Loading />
          <AuditFailure retry={() => undefined} />
        </>,
        locale,
      );
      expect(screen.getByRole("status")).toHaveAccessibleName(t.loading);
      expect(screen.getByRole("alert")).toHaveTextContent(t.loadError);
      expect(screen.getByRole("button", { name: t.retry })).toBeVisible();
    });
    it("explains permission without rendering actions", () => {
      view(<AuditNotPermitted />, locale);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        t.notPermitted,
      );
      expect(screen.getByText(t.permissionReason)).toBeVisible();
      expect(
        screen.queryByRole("button", { name: t.verify }),
      ).not.toBeInTheDocument();
    });
    it.each([false, true])(
      "distinguishes empty trail and no matches when filtered=%s",
      (filtered) => {
        view(
          <AuditTrail
            companyId="10000000-0000-4000-8000-000000000001"
            locale={locale}
            initial={{ events: [], nextCursor: null }}
            initialFilters={filtered ? { refusalsOnly: "true" } : {}}
            synthetic={false}
          />,
          locale,
        );
        expect(
          screen.getByText(filtered ? t.noMatches : t.empty),
        ).toBeVisible();
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      },
    );
    it("focuses the error summary on invalid input", () => {
      view(<AuditError code="VALIDATION_FAILED" />, locale);
      expect(screen.getByRole("alert")).toHaveFocus();
      expect(screen.getByRole("alert")).toHaveTextContent(t.invalidFilters);
    });
  });
