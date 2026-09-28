import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render-with-intl";
import { EstateMoneyAmount } from "../components/fils-amount";
import { aedAmountSchema } from "../contract";
describe.each(["en", "ar"] as const)("%s exact mandate amounts", (locale) => {
  it("uses the shared amount component for ordinary fils values", () => {
    const view = renderWithIntl(
      <EstateMoneyAmount fils="200000" locale={locale} />,
      { locale },
    );
    expect(
      view.container.querySelector('[data-slot="money-amount"]'),
    ).not.toBeNull();
    expect(screen.getByText(/2,000\.00/)).toBeVisible();
  });
  it("preserves cents beyond the safe integer range and below that boundary", () => {
    const view = renderWithIntl(
      <EstateMoneyAmount fils="9007199254740993" locale={locale} />,
      { locale },
    );
    expect(screen.getByText(/90,071,992,547,409\.93/)).toBeVisible();
    view.unmount();
    renderWithIntl(
      <EstateMoneyAmount fils="9007199254740991" locale={locale} />,
      { locale },
    );
    expect(screen.getByText(/90,071,992,547,409\.91/)).toBeVisible();
  });
});
it("converts grouped AED to integer fils and rejects fractional fils", () => {
  expect(aedAmountSchema.parse("90,071,992,547,409.93")).toBe(
    "9007199254740993",
  );
  expect(aedAmountSchema.safeParse("1.001").success).toBe(false);
  expect(aedAmountSchema.safeParse("2,00").success).toBe(false);
});
