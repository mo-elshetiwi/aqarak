import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getDirection, type Locale } from "@aqarak/i18n";
export function renderWithIntl(
  ui: ReactElement,
  { locale = "en" }: { locale?: Locale } = {},
): RenderResult {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={getMessages(locale)}
      timeZone="Asia/Dubai"
    >
      <DirectionProvider direction={getDirection(locale)}>
        {ui}
      </DirectionProvider>
    </NextIntlClientProvider>,
  );
}
