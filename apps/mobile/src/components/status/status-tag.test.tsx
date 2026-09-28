import { render, screen } from "@testing-library/react-native";
import { getMessages } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { StatusTag } from "./status-tag";
import { statusTagSchema, stateTones } from "./states";
it.each(["en", "ar"] as const)(
  "AC-7 %s renders every status word with its tone icon and accessible label",
  async (locale) => {
    const labels = getMessages(locale).Mobile.Status;
    for (const [domain, states] of Object.entries(labels)) {
      for (const [state, word] of Object.entries(states)) {
        const props = statusTagSchema.parse({ domain, state });
        await render(
          <LocaleProvider initialLocale={locale}>
            <StatusTag {...props} />
          </LocaleProvider>,
        );
        expect(screen.getByText(word)).toBeTruthy();
        expect(screen.getByLabelText(word)).toBeTruthy();
        expect(
          // The decorative icon is hidden from screen readers; the enclosing label carries the word.
          screen.getByTestId(`status-icon-${stateTones[props.state]}`, {
            includeHiddenElements: true,
          }),
        ).toBeTruthy();
        await screen.unmount();
      }
    }
  },
);
it("rejects state IDs from another domain", () => {
  expect(
    statusTagSchema.safeParse({ domain: "contract", state: "approved" })
      .success,
  ).toBe(false);
});
