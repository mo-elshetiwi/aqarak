import { AccessibilityInfo, Animated } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { getMessages } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { Text } from "@/components/ui/text";
import {
  EmptyState,
  LoadingState,
  ErrorState,
  NotFoundState,
  ExpiredDraftState,
  PendingApprovalState,
} from "./screen-states";
afterEach(() => {
  jest.restoreAllMocks();
});
it.each(["en", "ar"] as const)(
  "AC-9 %s renders state sentences, one action each, an alert and the pending lock",
  async (locale) => {
    const t = getMessages(locale).Mobile.States;
    const action = jest.fn();
    await render(
      <LocaleProvider initialLocale={locale}>
        <EmptyState action={{ label: t.home, onPress: action }} />
      </LocaleProvider>,
    );
    expect(screen.getByText(t.empty)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await fireEvent.press(screen.getByText(t.home));
    expect(action).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await render(
      <LocaleProvider initialLocale={locale}>
        <ErrorState onRetry={action} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(t.error);
    await fireEvent.press(screen.getByText(t.retry));
    expect(action).toHaveBeenCalledTimes(2);
    await screen.unmount();
    await render(
      <LocaleProvider initialLocale={locale}>
        <NotFoundState onHome={action} />
      </LocaleProvider>,
    );
    expect(screen.getByText(t.notFound)).toBeTruthy();
    await fireEvent.press(screen.getByRole("link"));
    expect(action).toHaveBeenCalledTimes(3);
    await screen.unmount();
    await render(
      <LocaleProvider initialLocale={locale}>
        <ExpiredDraftState onDraftAgain={action} />
      </LocaleProvider>,
    );
    expect(screen.getByText(t.expired)).toBeTruthy();
    await fireEvent.press(screen.getByText(t.draftAgain));
    expect(action).toHaveBeenCalledTimes(4);
    await screen.unmount();
    await render(
      <LocaleProvider initialLocale={locale}>
        <PendingApprovalState
          name="Layla Haddad"
          role="owner"
          age="3"
          stepper={<Text testID="frozen-stepper">C-01</Text>}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(t.locked)).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`Layla Haddad.*${t.roles.owner}`)),
    ).toBeTruthy();
    expect(screen.getByTestId("frozen-stepper")).toBeTruthy();
    expect(
      screen.getByText(getMessages(locale).Mobile.Status.approval.requested),
    ).toBeTruthy();
  },
);
it("AC-9 reduced-motion loading keeps static 56 and 72 pixel skeleton rows", async () => {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(true);
  const animation = jest.spyOn(Animated, "loop");
  await render(
    <LocaleProvider initialLocale="en">
      <LoadingState />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("loading-static")).toBeTruthy();
  expect(screen.getByTestId("skeleton-compact")).toHaveStyle({ height: 56 });
  expect(screen.getByTestId("skeleton-expanded")).toHaveStyle({ height: 72 });
  expect(animation).not.toHaveBeenCalled();
});
it("AC-9 a role placeholder keeps its honest sentence without adding an action", async () => {
  await render(
    <LocaleProvider initialLocale="en">
      <EmptyState sentence={getMessages("en").Mobile.content.inbox} />
    </LocaleProvider>,
  );
  expect(screen.getByText("Your inbox items appear here.")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
