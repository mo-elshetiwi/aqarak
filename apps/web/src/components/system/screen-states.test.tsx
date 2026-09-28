import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import {
  type EmptyStateProps,
  ErrorSummary,
  FieldError,
  EmptyState,
  ErrorState,
  OfflineBanner,
  DemoBanner,
  NotFoundState,
  NotPermittedState,
  PageSkeleton,
  TableSkeleton,
} from "./screen-states";
import { Input } from "@/components/ui/input";
import { PageHeader } from "./page-header";
import { MoneyAmount, DateText, IdentifierText } from "./formatted-values";
for (const locale of ["en", "ar"] as const) {
  describe(`${locale} screen states`, () => {
    it("focuses the summary and associates every link, field and repeated message", async () => {
      const messages = getMessages(locale);
      const errors = [
        { fieldId: "owner", message: messages.Common.nameError },
        { fieldId: "email", message: messages.Common.emailError },
      ];
      renderWithIntl(
        <>
          <ErrorSummary errors={errors} />
          {errors.map((error) => (
            <div key={error.fieldId}>
              <Input
                aria-label={error.fieldId}
                id={error.fieldId}
                aria-describedby={`${error.fieldId}-error`}
              />
              <FieldError
                id={`${error.fieldId}-error`}
                message={error.message}
              />
            </div>
          ))}
        </>,
        { locale },
      );
      expect(screen.getByRole("alert")).toHaveFocus();
      const user = userEvent.setup();
      for (const error of errors) {
        const link = screen.getByRole("link", { name: error.message });
        expect(link).toHaveAttribute("href", `#${error.fieldId}`);
        expect(
          screen.getByLabelText(error.fieldId),
        ).toHaveAccessibleDescription(error.message);
        await user.click(link);
        expect(screen.getByLabelText(error.fieldId)).toHaveFocus();
        expect(screen.getAllByText(error.message)).toHaveLength(2);
      }
    });
    it("keeps an empty section's icon and sentence without an action", () => {
      const message = getMessages(locale).Navigation.empty.home;
      const { container } = renderWithIntl(
        <EmptyState variant="no-records" message={message} />,
        { locale },
      );
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        message,
      );
      expect(container.querySelector('svg[aria-hidden="true"]')).toHaveClass(
        "lucide-circle-dashed",
        "size-6",
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(container.textContent).toBe(message);
    });
    it("offers the right actions for empty and failed lists", () => {
      const messages = getMessages(locale);
      const add = vi.fn(),
        clear = vi.fn(),
        retry = vi.fn();
      renderWithIntl(
        <>
          <EmptyState variant="no-records" onAction={add} />
          <EmptyState variant="no-matches" onAction={clear} />
          <ErrorState onRetry={retry} />
        </>,
        { locale },
      );
      fireEvent.click(
        screen.getByRole("button", { name: messages.Common.addOwner }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: messages.Common.clearFilters }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: messages.Common.retry }),
      );
      expect(add).toHaveBeenCalledOnce();
      expect(clear).toHaveBeenCalledOnce();
      expect(retry).toHaveBeenCalledOnce();
    });
    it("separates missing records from role restrictions without revealing records", () => {
      const messages = getMessages(locale);
      renderWithIntl(
        <>
          <NotFoundState />
          <NotPermittedState />
          <DemoBanner />
        </>,
        { locale },
      );
      expect(screen.getByText(messages.States.notFound)).toBeInTheDocument();
      expect(
        screen.getByText(messages.States.notPermitted),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("link", { name: messages.Common.home }),
      ).toHaveLength(2);
      expect(screen.getByRole("status")).toHaveTextContent(
        messages.States.demo,
      );
    });
  });
}
it("responds to connection changes and allows a forced showcase example", async () => {
  let online = true;
  const getter = vi
    .spyOn(navigator, "onLine", "get")
    .mockImplementation(() => online);
  const { rerender } = renderWithIntl(<OfflineBanner />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  online = false;
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("status")).toHaveTextContent(
    getMessages("en").States.offline,
  );
  online = true;
  await act(() => window.dispatchEvent(new Event("online")));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  rerender(<></>);
  getter.mockRestore();
  renderWithIntl(<OfflineBanner forceVisible />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("keeps loading geometry and formatted semantics", () => {
  const { container } = renderWithIntl(
    <>
      <PageSkeleton />
      <TableSkeleton />
      <MoneyAmount fils={8500000} locale="ar" />
      <DateText iso="2026-09-28" locale="ar" />
      <IdentifierText kind="emirates_id" value="784-1978-4829163-5" masked />
    </>,
  );
  expect(container.querySelectorAll(".h-11")).toHaveLength(5);
  expect(container.querySelector(".h-9")).toBeInTheDocument();
  expect(screen.getByText("85,000.00 درهم").parentElement).toHaveClass(
    "tabular-nums",
  );
  expect(container.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-09-28",
  );
  expect(screen.getByText("784-••••-•••••63-5")).toHaveAttribute("dir", "ltr");
  expect(screen.getByText("784-••••-•••••63-5").tagName).toBe("BDI");
});
it("renders one title and one primary action in a page header", () => {
  const callback = vi.fn();
  const { container } = renderWithIntl(
    <PageHeader
      title="Owners"
      description="Review owners"
      primaryAction={{ label: "Add owner", onClick: callback }}
      secondaryAction={{ label: "Export", onClick: callback }}
    />,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(container.querySelectorAll('[data-variant="default"]')).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add owner" }));
  expect(callback).toHaveBeenCalledOnce();
});

it("requires the clear action for no-matches while allowing actionless records", () => {
  expectTypeOf<{ variant: "no-records" }>().toExtend<EmptyStateProps>();
  expectTypeOf<{ variant: "no-matches" }>().not.toExtend<EmptyStateProps>();
  expectTypeOf<{
    variant: "no-matches";
    onAction: () => void;
  }>().toExtend<EmptyStateProps>();
});
