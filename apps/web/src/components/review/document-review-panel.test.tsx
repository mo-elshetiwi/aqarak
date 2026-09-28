import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import { DocumentReviewPanel } from "./document-review-panel";
import type { SuggestedFieldInput } from "./types";
beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
const fields: SuggestedFieldInput[] = [
  {
    id: "name",
    label: "Name",
    fieldClass: "text",
    value: "Khalid",
    modelCategory: "check",
    region: null,
    requiresSourceCheck: false,
  },
  {
    id: "identity",
    label: "ID",
    fieldClass: "identity_number",
    value: "784-1978-4829163-5",
    modelCategory: "suggested",
    region: { page: 1, x: 0.2, y: 0.3, width: 0.5, height: 0.1 },
    requiresSourceCheck: true,
  },
  {
    id: "occupation",
    label: "Occupation",
    fieldClass: "text",
    value: "Coordinator",
    modelCategory: "suggested",
    region: null,
    requiresSourceCheck: false,
  },
  {
    id: "absent",
    label: "Card number",
    fieldClass: "text",
    value: null,
    modelCategory: "check",
    region: null,
    requiresSourceCheck: false,
  },
];
const props = {
  document: {
    title: "Synthetic ID",
    synthetic: true,
    pages: [
      {
        number: 1,
        imageSrc: "/showcase/synthetic-emirates-id-front.svg",
        alt: "Synthetic card",
      },
    ],
  },
  fields,
  calibratedClasses: ["text"] as "text"[],
  provenance: {
    registryEntry: "document-extraction",
    version: "2026-09-28.1",
    ranAt: "2026-09-28T06:00:00+04:00",
  },
};
for (const locale of ["en", "ar"] as const)
  describe(`${locale} document review`, () => {
    it("accepts, edits, reverts, marks absence and reports only explicit decisions", async () => {
      const user = userEvent.setup();
      const onContinue = vi.fn();
      const messages = getMessages(locale).Review;
      renderWithIntl(
        <DocumentReviewPanel {...props} onContinue={onContinue} />,
        { locale },
      );
      const name = screen.getByTestId("field-name");
      const identity = screen.getByTestId("field-identity");
      const occupation = screen.getByTestId("field-occupation");
      await user.click(
        within(name).getByRole("button", {
          name: locale === "en" ? "Accept Name" : "قبول Name",
        }),
      );
      expect(name).toHaveAttribute("data-state", "accepted");
      expect(
        within(name).queryByText(messages.aiSuggested),
      ).not.toBeInTheDocument();
      await user.click(
        within(name).getByRole("button", {
          name: locale === "en" ? "Edit Name" : "تعديل Name",
        }),
      );
      const input = within(name).getByRole("textbox");
      await user.clear(input);
      await user.type(input, "Khalid Al Suwaidi");
      await user.click(
        within(name).getByRole("button", { name: messages.save }),
      );
      expect(name).toHaveAttribute("data-state", "edited");
      expect(name).not.toHaveClass("bg-ai-bg");
      await user.click(
        within(name).getByRole("button", { name: messages.revert }),
      );
      expect(name).toHaveAttribute("data-state", "undecided");
      expect(within(name).getByText("Khalid")).toBeInTheDocument();
      expect(within(name).getByText(messages.aiSuggested)).toBeInTheDocument();
      await user.click(
        within(name).getByRole("button", { name: messages.notOnDocument }),
      );
      expect(name).toHaveAttribute("data-state", "not_on_document");
      await user.click(
        within(identity).getByRole("button", {
          name: locale === "en" ? "View source for ID" : "عرض مصدر ID",
        }),
      );
      await user.click(
        within(identity).getByRole("button", {
          name: locale === "en" ? "Accept ID" : "قبول ID",
        }),
      );
      await user.click(
        within(occupation).getByRole("button", {
          name: locale === "en" ? "Edit Occupation" : "تعديل Occupation",
        }),
      );
      await user.clear(within(occupation).getByRole("textbox"));
      await user.type(within(occupation).getByRole("textbox"), "Manager");
      await user.click(
        within(occupation).getByRole("button", { name: messages.save }),
      );
      await user.click(screen.getByRole("button", { name: messages.continue }));
      expect(onContinue).toHaveBeenCalledWith({
        name: {
          status: "not_on_document",
          value: null,
          sourceViewed: false,
          provenance: "not_on_document",
        },
        identity: {
          status: "accepted",
          value: "784-1978-4829163-5",
          sourceViewed: true,
          provenance: "ai_confirmed",
        },
        occupation: {
          status: "edited",
          value: "Manager",
          sourceViewed: false,
          provenance: "ai_edited",
        },
      });
    }, 15000);
    it("links the disabled reason and source region to the field", async () => {
      const user = userEvent.setup();
      const messages = getMessages(locale).Review;
      renderWithIntl(<DocumentReviewPanel {...props} onContinue={vi.fn()} />, {
        locale,
      });
      const row = screen.getByTestId("field-identity");
      const accept = within(row).getByRole("button", {
        name: locale === "en" ? "Accept ID" : "قبول ID",
      });
      expect(accept).toBeDisabled();
      expect(accept).toHaveAccessibleDescription(messages.openSourceFirst);
      expect(
        screen.getByRole("button", { name: messages.continue }),
      ).toBeDisabled();
      await user.click(
        within(row).getByRole("button", {
          name: locale === "en" ? "View source for ID" : "عرض مصدر ID",
        }),
      );
      expect(accept).toBeEnabled();
      const region = screen.getByTestId("source-region");
      expect(region).toHaveClass("outline-2", "outline-brand");
      expect(region.getAttribute("aria-describedby")).toBe(
        row.getAttribute("aria-describedby"),
      );
      expect(region).toHaveAccessibleDescription(
        locale === "en" ? "Source for ID, page 1." : "مصدر الحقل ID، الصفحة 1.",
      );
      expect(within(row).getByText(messages.sourceOpened)).toBeInTheDocument();
      expect(row).toHaveClass("bg-ai-bg");
      expect(within(row).getByText(messages.sourceOpened)).toHaveClass(
        "text-foreground",
      );
      expect(
        within(screen.getByTestId("field-absent")).getByText(
          messages.notOnDocument,
          { selector: "span" },
        ),
      ).toHaveClass("text-foreground");
      await user.click(
        within(screen.getByTestId("field-name")).getByRole("button", {
          name: locale === "en" ? "View source for Name" : "عرض مصدر Name",
        }),
      );
      expect(screen.getByTestId("page-marker")).toHaveTextContent("Name");
      expect(screen.queryByTestId("source-region")).not.toBeInTheDocument();
    });
    it("opens model provenance with keyboard and returns focus on Escape", async () => {
      const user = userEvent.setup();
      const messages = getMessages(locale).Review;
      renderWithIntl(<DocumentReviewPanel {...props} onContinue={vi.fn()} />, {
        locale,
      });
      const trigger = within(screen.getByTestId("field-identity")).getByRole(
        "button",
        { name: messages.aiSuggested },
      );
      trigger.focus();
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("document-extraction");
      expect(dialog).toHaveTextContent("2026-09-28.1");
      expect(dialog).toHaveTextContent(messages.limits.identity_number);
      await user.keyboard("{Escape}");
      expect(trigger).toHaveFocus();
    });
    it("bulk acceptance cannot decide Confirm or Check fields", () => {
      const messages = getMessages(locale).Review;
      renderWithIntl(<DocumentReviewPanel {...props} onContinue={vi.fn()} />, {
        locale,
      });
      fireEvent.click(
        screen.getByRole("button", { name: messages.acceptRemaining }),
      );
      expect(screen.getByTestId("field-occupation")).toHaveAttribute(
        "data-state",
        "accepted",
      );
      for (const id of ["identity", "name", "absent"])
        expect(screen.getByTestId(`field-${id}`)).toHaveAttribute(
          "data-state",
          "undecided",
        );
      expect(
        screen.getByRole("button", { name: messages.continue }),
      ).toBeDisabled();
    });
  });
