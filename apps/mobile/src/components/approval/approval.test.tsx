import { PixelRatio } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { getMessages } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { ApprovalStepper, type ApprovalStepperProps } from "./approval-stepper";
import {
  ApprovalReview,
  approvalReviewSchema,
  type ApprovalReviewProps,
} from "./approval-review";
const layla = { en: "Layla Haddad", ar: "ليلى حداد" };
const khalid = { en: "Khalid Al Suwaidi", ar: "خالد السويدي" };
const omar = { en: "Omar Farouk", ar: "عمر فاروق" };
function stepper(): ApprovalStepperProps {
  return {
    ownerGate: true,
    now: "2026-10-01T06:42:00Z",
    manager: {
      name: layla,
      state: "done",
      decision: "submitted",
      decidedAt: "2026-09-28T06:42:00Z",
    },
    owner: {
      name: khalid,
      state: "current",
      requestedAt: "2026-09-28T06:42:00Z",
    },
    tenant: { name: omar, state: "waiting" },
  };
}
function props(viewer: "owner" | "tenant" = "owner"): ApprovalReviewProps {
  return {
    reference: "C-01",
    viewer,
    status:
      viewer === "owner"
        ? "awaiting_owner_approval"
        : "awaiting_tenant_acceptance",
    unit: { en: "104", ar: "104" },
    property: { en: "Al Waha Residence", ar: "سكن الواحة" },
    owner: khalid,
    tenant: omar,
    startsOn: "2026-10-01",
    endsOn: "2027-09-30",
    annualRentFils: 8500000,
    instalments: 4,
    version: 2,
    changesCount: 3,
    stepper: stepper(),
    onApprove: jest.fn(),
    onRequestChanges: jest.fn(),
  };
}
afterEach(() => {
  jest.restoreAllMocks();
});
it.each(["en", "ar"] as const)(
  "AC-11 %s removes the owner step entirely when its frozen gate is off",
  async (locale) => {
    await render(
      <LocaleProvider initialLocale={locale}>
        <ApprovalStepper {...stepper()} ownerGate={false} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("approval-step-manager")).toBeTruthy();
    expect(screen.getByTestId("approval-step-tenant")).toBeTruthy();
    expect(screen.queryByTestId("approval-step-owner")).toBeNull();
    await screen.unmount();
    await render(
      <LocaleProvider initialLocale={locale}>
        <ApprovalStepper {...stepper()} />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("approval-step-owner")).toHaveProp(
      "accessibilityLabel",
      expect.stringContaining(locale === "en" ? "Current" : "الحالية"),
    );
    expect(
      screen.getByText(
        locale === "en"
          ? "Waiting for Khalid Al Suwaidi (Owner) · 3 days"
          : "بانتظار خالد السويدي (المالك) · منذ 3 أيام",
      ),
    ).toBeTruthy();
  },
);
it.each(["owner", "tenant"] as const)(
  "AC-11 %s checks the consequence before confirming exactly once",
  async (viewer) => {
    const input = props(viewer);
    let finish: (() => void) | undefined;
    input.onApprove = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await render(
      <LocaleProvider initialLocale="en">
        <ApprovalReview {...input} />
      </LocaleProvider>,
    );
    await fireEvent.press(screen.getByTestId("approval-approve"));
    expect(input.onApprove).not.toHaveBeenCalled();
    expect(
      screen.getByText(getMessages("en").Mobile.Approval.effect[viewer]),
    ).toBeTruthy();
    expect(
      screen.getByText(
        viewer === "owner"
          ? "Omar Farouk acts next as tenant."
          : "No further approval is required.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId("approval-confirm"));
    await fireEvent.press(screen.getByTestId("approval-confirm"));
    expect(input.onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("approval-confirm")).toBeDisabled();
    await act(() => {
      finish?.();
    });
  },
);
it.each(["en", "ar"] as const)(
  "AC-11 %s repeats the same reason error twice and submits trimmed text once",
  async (locale) => {
    const input = props();
    await render(
      <LocaleProvider initialLocale={locale}>
        <ApprovalReview {...input} />
      </LocaleProvider>,
    );
    await fireEvent.press(screen.getByTestId("approval-request-changes"));
    await fireEvent.press(screen.getByTestId("approval-submit-changes"));
    const message = getMessages(locale).Mobile.Approval.reasonError;
    expect(screen.getByTestId("approval-reason-summary")).toHaveTextContent(
      message,
    );
    expect(screen.getByTestId("approval-reason-error")).toHaveTextContent(
      message,
    );
    expect(screen.getAllByText(message)).toHaveLength(2);
    expect(input.onRequestChanges).not.toHaveBeenCalled();
    await fireEvent.changeText(
      screen.getByTestId("approval-reason"),
      "  Revise the term dates.  ",
    );
    await fireEvent.press(screen.getByTestId("approval-submit-changes"));
    await fireEvent.press(screen.getByTestId("approval-submit-changes"));
    expect(input.onRequestChanges).toHaveBeenCalledTimes(1);
    expect(input.onRequestChanges).toHaveBeenCalledWith(
      "Revise the term dates.",
    );
  },
);
it("AC-11 Arabic review keeps Western numbers and isolated identifiers in a scrolling RTL view at font scale 2", async () => {
  jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(2);
  await render(
    <LocaleProvider initialLocale="ar">
      <ApprovalReview {...props()} />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("approval-review")).toHaveStyle({
    direction: "rtl",
  });
  expect(screen.getByText("\u2066C-01\u2069")).toHaveStyle({
    writingDirection: "ltr",
  });
  expect(screen.getByText("85,000.00 درهم")).toBeTruthy();
  expect(
    screen.getByText("3 تغييرات منذ النسخة التي رأيتها آخر مرة"),
  ).toBeTruthy();
  expect(screen.getByTestId("approval-approve")).toBeEnabled();
});
it("blocked decisions are disabled and explain the connection requirement", async () => {
  await render(
    <LocaleProvider initialLocale="en">
      <ApprovalReview
        {...props()}
        commitBlockedReason={getMessages("en").Mobile.Connectivity.required}
      />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("approval-approve")).toBeDisabled();
  expect(screen.getByTestId("approval-request-changes")).toBeDisabled();
  expect(
    screen.getByText("You are offline. This needs a connection."),
  ).toBeTruthy();
});
it("rejects oversized reasons, fractional rent and an owner review with the gate off", async () => {
  const input = props();
  expect(
    approvalReviewSchema.safeParse({ ...input, annualRentFils: 1.5 }).success,
  ).toBe(false);
  expect(
    approvalReviewSchema.safeParse({
      ...input,
      stepper: { ...stepper(), ownerGate: false },
    }).success,
  ).toBe(false);
  await render(
    <LocaleProvider initialLocale="en">
      <ApprovalReview {...input} />
    </LocaleProvider>,
  );
  await fireEvent.press(screen.getByTestId("approval-request-changes"));
  await fireEvent.changeText(
    screen.getByTestId("approval-reason"),
    "x".repeat(501),
  );
  await fireEvent.press(screen.getByTestId("approval-submit-changes"));
  expect(input.onRequestChanges).not.toHaveBeenCalled();
});
