import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getMessages } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import {
  DraftedActionCard,
  draftedActionCardSchema,
  type DraftedActionCardProps,
} from "./drafted-action-card";
const copy = { en: "Create ticket · Unit 104", ar: "إنشاء بلاغ · الوحدة 104" };
function props(): DraftedActionCardProps {
  return {
    id: "synthetic-1",
    title: copy,
    state: "ready",
    kind: "action",
    origin: { channel: "voice", at: "2026-09-28T06:42:00Z" },
    changes: [{ label: copy, after: copy }],
    expiryRule: {
      en: "Valid until the record changes.",
      ar: "صالح حتى يتغير السجل.",
    },
    consequence: {
      en: "Creates a ticket for Unit 104.",
      ar: "ينشئ بلاغاً للوحدة 104.",
    },
    onConfirm: jest.fn(),
    onDiscard: jest.fn(),
    onEdit: jest.fn(),
    onOpenReview: jest.fn(),
    onDraftAgain: jest.fn(),
  };
}
it.each(["en", "ar"] as const)(
  "AC-10 %s confirms once and disables every action while pending",
  async (locale) => {
    let finish: (() => void) | undefined;
    const input = props();
    input.onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render(
      <LocaleProvider initialLocale={locale}>
        <DraftedActionCard {...input} />
      </LocaleProvider>,
    );
    expect(
      screen.getByText(
        locale === "en"
          ? "From your voice order, 10:42"
          : "من طلبك الصوتي، 10:42",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
    await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
    expect(input.onConfirm).toHaveBeenCalledTimes(1);
    for (const id of [
      "drafted-action-confirm",
      "drafted-action-edit",
      "drafted-action-discard",
    ])
      expect(screen.getByTestId(id)).toBeDisabled();
    await act(() => {
      finish?.();
    });
    await fireEvent.press(screen.getByTestId("drafted-action-confirm"));
    expect(input.onConfirm).toHaveBeenCalledTimes(1);
  },
);
it("AC-10 a blocked commit displays its reason and disables only Confirm", async () => {
  await render(
    <LocaleProvider initialLocale="en">
      <DraftedActionCard
        {...props()}
        commitBlockedReason={getMessages("en").Mobile.Connectivity.required}
      />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("drafted-action-confirm")).toBeDisabled();
  expect(screen.getByTestId("drafted-action-edit")).toBeEnabled();
  expect(
    screen.getByText("You are offline. This needs a connection."),
  ).toBeTruthy();
});
it("AC-10 an approval opens review and never offers Confirm", async () => {
  const input = props();
  await render(
    <LocaleProvider initialLocale="en">
      <DraftedActionCard {...input} kind="approval" />
    </LocaleProvider>,
  );
  expect(screen.queryByTestId("drafted-action-confirm")).toBeNull();
  await fireEvent.press(screen.getByText("Open review"));
  expect(input.onOpenReview).toHaveBeenCalledTimes(1);
});
it.each(["expired", "failed"] as const)(
  "AC-10 %s offers Draft again and no Confirm",
  async (state) => {
    const input = props();
    await render(
      <LocaleProvider initialLocale="en">
        <DraftedActionCard
          {...input}
          state={state}
          failureReason={{ en: "The record changed.", ar: "تغير السجل." }}
        />
      </LocaleProvider>,
    );
    expect(screen.queryByTestId("drafted-action-confirm")).toBeNull();
    await fireEvent.press(screen.getByText("Draft again"));
    expect(input.onDraftAgain).toHaveBeenCalledTimes(1);
  },
);
it.each(["drafting", "committed", "rejected"] as const)(
  "%s has no decision controls",
  async (state) => {
    await render(
      <LocaleProvider initialLocale="en">
        <DraftedActionCard {...props()} state={state} />
      </LocaleProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  },
);
it("validates failure reasons and renders caller markup as literal text", async () => {
  expect(
    draftedActionCardSchema.safeParse({ ...props(), state: "failed" }).success,
  ).toBe(false);
  await render(
    <LocaleProvider initialLocale="en">
      <DraftedActionCard
        {...props()}
        title={{ en: "<b>Unit 104</b>", ar: "<b>الوحدة 104</b>" }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("<b>Unit 104</b>")).toBeTruthy();
});
