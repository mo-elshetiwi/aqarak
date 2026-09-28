import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/session/session";
import {
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
  MOCK_COMPANY_A_ID,
} from "@/lib/api/mock-fixtures";
const { current, csv } = vi.hoisted(() => ({
  current: vi.fn<() => Promise<CurrentSession | null>>(),
  csv: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session/session", () => ({ getCurrentSession: current }));
vi.mock("../_lib/client", () => ({
  canReadAudit: (c: { staffRoles: string[] }) =>
    c.staffRoles.some((r) => r === "manager" || r === "company_administrator"),
  getAuditClient: () => ({ exportCsv: csv }),
}));
import { GET } from "./route";
const params = Promise.resolve({ companyId: MOCK_COMPANY_A_ID });
const url = `http://localhost:3164/en/companies/${MOCK_COMPANY_A_ID}/audit/export`;
const manager = MOCK_ACCOUNTS.find((a) => a.handle === "manager-1");
if (!manager) throw new Error("Missing fixture");
const session: CurrentSession = {
  sessionId: "a".repeat(43),
  csrfToken: "",
  me: {
    account: {
      id: MOCK_ACCOUNT_IDS["manager-1"],
      displayName: manager.name.en,
      email: manager.email,
      locale: "en",
    },
    contexts: manager.contexts,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  current.mockResolvedValue(session);
});
describe("AC-8 CSV session and origin guard", () => {
  it("refuses a foreign Origin before loading or exporting", async () => {
    const response = await GET(
      new Request(url, { headers: { Origin: "https://foreign.example" } }),
      { params },
    );
    expect(response.status).toBe(403);
    expect(current).not.toHaveBeenCalled();
    expect(csv).not.toHaveBeenCalled();
  });
  it("refuses a missing session", async () => {
    current.mockResolvedValue(null);
    expect(
      (
        await GET(
          new Request(url, { headers: { Origin: "http://localhost:3164" } }),
          { params },
        )
      ).status,
    ).toBe(401);
    expect(csv).not.toHaveBeenCalled();
  });
  it("refuses missing Origin without same-origin browser evidence", async () => {
    expect((await GET(new Request(url), { params })).status).toBe(403);
    expect(csv).not.toHaveBeenCalled();
  });
  it("refuses browser GET without CSRF even with a same-origin referrer", async () => {
    expect(
      (
        await GET(
          new Request(url, {
            headers: { Referer: url, "Sec-Fetch-Site": "same-origin" },
          }),
          { params },
        )
      ).status,
    ).toBe(403);
    expect(csv).not.toHaveBeenCalled();
  });
  it("streams the API response and forwards only valid filters", async () => {
    const disposition = 'attachment; filename="audit-synthetic-20260928.csv"';
    csv.mockResolvedValue({
      ok: true,
      value: { body: new Blob(["seq,event_type\r\n"]).stream(), disposition },
    });
    const response = await GET(
      new Request(`${url}?refusalsOnly=true&initiator=person`, {
        headers: { Origin: "http://localhost:3164" },
      }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(disposition);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("seq,event_type\r\n");
    expect(csv).toHaveBeenCalledWith({
      refusalsOnly: "true",
      initiator: "person",
    });
  });
  it("rejects duplicate filters and accountant access", async () => {
    expect(
      (
        await GET(
          new Request(`${url}?refusalsOnly=true&refusalsOnly=false`, {
            headers: { Origin: "http://localhost:3164" },
          }),
          { params },
        )
      ).status,
    ).toBe(422);
    const accountant = MOCK_ACCOUNTS.find((a) => a.handle === "accountant-1");
    if (!accountant) throw new Error("Missing fixture");
    current.mockResolvedValue({
      ...session,
      me: { ...session.me, contexts: accountant.contexts },
    });
    expect(
      (
        await GET(
          new Request(url, { headers: { Origin: "http://localhost:3164" } }),
          { params },
        )
      ).status,
    ).toBe(403);
  });
});
