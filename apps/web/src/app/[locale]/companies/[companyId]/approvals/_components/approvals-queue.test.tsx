import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";
import type {
  ApprovalItem,
  ContractNotification,
} from "../../contracts/_lib/schemas";
import { ApprovalsQueue } from "./approvals-queue";
const calls = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../_lib/actions", () => ({ markRead: calls.read }));
const companyId = "20000000-0000-4000-8000-000000000001";
const items: ApprovalItem[] = [1, 2].map((n) => ({
  approvalId: `70000000-0000-4000-8000-00000000000${String(n)}`,
  contractId: `60000000-0000-4000-8000-00000000000${String(n)}`,
  contractNo: `C-0${String(n)}`,
  slot: "owner",
  versionNo: n,
  unit: {
    unitNo: String(103 + n),
    propertyName: { en: "Synthetic property", ar: "عقار تجريبي" },
  },
  submittedBy: "Synthetic manager",
  requestedAt: "2026-09-26T06:00:00.000Z",
  subjectHash: "a".repeat(64),
}));
const notices: ContractNotification[] = [1, 2].map((n) => ({
  id: `80000000-0000-4000-8000-00000000000${String(n)}`,
  templateCode: "contract_approval_requested",
  subjectType: "contract",
  subjectId: items[0]?.contractId ?? "",
  contractId: items[0]?.contractId ?? "",
  createdAt: "2026-09-26T06:00:00.000Z",
  readAt: n === 1 ? "2026-09-27T06:00:00.000Z" : null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  calls.read.mockResolvedValue({ ok: true });
});
function queue(rows = items, notifications: ContractNotification[] = []): void {
  renderWithIntl(
    <ApprovalsQueue
      items={rows}
      notifications={notifications}
      locale="en"
      companyId={companyId}
      csrfToken="token"
      now="2026-09-28T06:00:00.000Z"
    />,
  );
}
describe("Personal approvals queue", () => {
  it("links two requested approvals with the version, slot and age", () => {
    queue();
    const table = screen.getByRole("table", { name: "Approvals" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByText("2 days ago")).toHaveLength(2);
    expect(within(table).getAllByText("Owner")).toHaveLength(2);
    for (const item of items)
      expect(
        screen.getByRole("link", { name: item.contractNo }),
      ).toHaveAttribute(
        "href",
        `/en/companies/${companyId}/contracts/${item.contractId}`,
      );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("shows a calm empty state for a person with no approvals", () => {
    queue([]);
    expect(screen.getByText("Nothing is waiting for you.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("puts unread notices first and marks only the chosen notice with a key", async () => {
    queue([], notices);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Unread");
    await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => {
      expect(calls.read).toHaveBeenCalledTimes(1);
    });
    expect(calls.read).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        csrfToken: "token",
        input: { notificationId: notices[1]?.id },
        idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) as unknown,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Mark as read" }),
    ).not.toBeInTheDocument();
  });
});

it("keeps notifications visible without claiming the approvals queue is empty when it failed", () => {
  renderWithIntl(
    <ApprovalsQueue
      items={[]}
      notifications={notices}
      approvalsLoaded={false}
      locale="en"
      companyId={companyId}
      csrfToken="token"
      now="2026-09-28T06:00:00.000Z"
    />,
  );
  expect(
    screen.queryByText("Nothing is waiting for you."),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
