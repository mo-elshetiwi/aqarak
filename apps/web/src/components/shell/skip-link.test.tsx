import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { SkipLink } from "./skip-link";
afterEach(cleanup);
for (const locale of ["en", "ar"] as const) {
  it(`${locale} moves focus to content, including earlier pages without a main id`, () => {
    renderWithIntl(
      <>
        <SkipLink />
        <main>
          <h1>{getMessages(locale).Navigation.sections.home}</h1>
        </main>
      </>,
      { locale },
    );
    fireEvent.click(
      screen.getByRole("link", { name: getMessages(locale).Auth.skip }),
    );
    expect(screen.getByRole("main")).toHaveFocus();
  });
}
