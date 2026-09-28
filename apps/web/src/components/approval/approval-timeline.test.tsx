import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMessages } from "@aqarak/i18n";
import { renderWithIntl } from "@/test/render-with-intl";
import {
  ApprovalTimeline,
  PendingApprovalState,
  type ApprovalStep,
} from "./approval-timeline";
const now = "2026-09-28T10:00:00+04:00";
function steps(owner: string): ApprovalStep[] {
  return [
    {
      slot: "manager",
      personName: "Mariam",
      status: "approved",
      decidedAt: "2026-09-27T10:00:00+04:00",
      requestedAt: "2026-09-26T10:00:00+04:00",
    },
    {
      slot: "owner",
      personName: owner,
      status: "requested",
      decidedAt: null,
      requestedAt: "2026-09-26T10:00:00+04:00",
    },
    {
      slot: "tenant",
      personName: "Omar",
      status: "waiting",
      decidedAt: null,
      requestedAt: null,
    },
  ];
}
for (const locale of ["en", "ar"] as const)
  describe(`${locale} approval timeline`, () => {
    it("omits the owner entirely when the gate is off", () => {
      const { container } = renderWithIntl(
        <ApprovalTimeline
          steps={steps("Khalid")}
          ownerGate={false}
          now={now}
        />,
        { locale },
      );
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      expect(
        container.querySelector('[data-slot="owner"]'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Khalid")).not.toBeInTheDocument();
    });
    it("orders three slots and identifies the current step, name and age", () => {
      const name = locale === "en" ? "Khalid Al Suwaidi" : "خالد السويدي";
      const { container } = renderWithIntl(
        <ApprovalTimeline
          steps={steps(name).reverse()}
          ownerGate
          now={now}
          viewerSlot="owner"
          version={{ number: 1, hashPrefix: "9f3c 7a02 b81e a21e" }}
        />,
        { locale },
      );
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(items.map((item) => item.getAttribute("data-slot"))).toEqual([
        "manager",
        "owner",
        "tenant",
      ]);
      const current = container.querySelector('[aria-current="step"]');
      expect(current).toHaveAttribute("data-slot", "owner");
      expect(current).toHaveTextContent(
        locale === "en"
          ? "Waiting for Khalid Al Suwaidi (owner) · 2 days"
          : "بانتظار خالد السويدي (المالك) · منذ يومين",
      );
      expect(
        screen.getAllByText(name).every((element) => element.tagName === "BDI"),
      ).toBe(true);
      expect(container.querySelectorAll("time")).toHaveLength(2);
      expect(screen.getByText(/9f3c/)).toHaveAttribute("dir", "ltr");
    });
    it("shows contract status and the locked-version notice", () => {
      const messages = getMessages(locale);
      renderWithIntl(
        <PendingApprovalState
          contractState="awaiting_owner_approval"
          steps={steps("Khalid")}
          ownerGate
          now={now}
        />,
        { locale },
      );
      expect(screen.getByText(messages.Approval.locked)).toBeInTheDocument();
      expect(screen.getByText(messages.Approval.locked)).toHaveClass(
        "bg-muted",
        "text-foreground",
      );
      expect(
        screen.getByText(messages.Status.contract.awaiting_owner_approval),
      ).toBeInTheDocument();
    });
    it.each(["approved", "changes_requested", "voided"] as const)(
      "shows the %s decision without presenting a waiting request",
      (status) => {
        const records = steps("Khalid").map((step): ApprovalStep => ({
          ...step,
          status,
          decidedAt: now,
        }));
        const { container } = renderWithIntl(
          <ApprovalTimeline steps={records} ownerGate now={now} />,
          { locale },
        );
        const list = screen.getByRole("list");
        expect(
          within(list).getAllByText(
            getMessages(locale).Status.approval[status],
          ),
        ).toHaveLength(3);
        expect(list).not.toHaveTextContent(
          locale === "en" ? "Waiting for" : "بانتظار خالد",
        );
        expect(
          container.querySelectorAll('[aria-current="step"]'),
        ).toHaveLength(status === "changes_requested" ? 1 : 0);
      },
    );
  });
it.each([
  [0, "اليوم"],
  [1, "منذ يوم"],
  [2, "منذ يومين"],
  [3, "منذ 3 أيام"],
  [11, "منذ 11 يوماً"],
  [100, "منذ 100 يوم"],
])("uses Arabic plural rules for %i days", (count, age) => {
  const records = steps("خالد السويدي").map((step) => ({
    ...step,
    requestedAt: new Date(Date.parse(now) - count * 86400000).toISOString(),
  }));
  renderWithIntl(<ApprovalTimeline steps={records} ownerGate now={now} />, {
    locale: "ar",
  });
  expect(screen.getAllByRole("listitem")[1]).toHaveTextContent(
    `بانتظار خالد السويدي (المالك) · ${age}`,
  );
});
