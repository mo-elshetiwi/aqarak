import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createContractsHttp,
  getContractsApi,
  type ContractsApi,
} from "./contracts-api";
import { company, draft, key, setupMock } from "./test-fixtures";
import { termsInputSchema } from "./schemas";
import { mockDraftingOptions } from "./contracts-mock";
const session = "a".repeat(43);
const id = "60000000-0000-4000-8000-000000000001";
const token = "b".repeat(32);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("Contracts HTTP transport", () => {
  it("sends every documented path, verb, header and body and validates successes", async () => {
    const mock = setupMock();
    const created = await mock.api.create(
      await mock.login("manager-1"),
      company,
      draft(),
      key(),
    );
    if (!created.ok) throw new Error(created.error.code);
    created.value.version.specialClauses = [
      {
        position: 1,
        textEn: "Synthetic clause",
        textAr: "نص اصطناعي",
        modelTranslated: true,
        suggestion: {
          registryEntry: "synthetic",
          promptVersion: "1",
          confirmation: "ai_edited",
        },
      },
    ];
    created.value.deliveries = [
      {
        notificationId: id,
        recipientName: "Synthetic manager",
        channel: "email",
        templateCode: "contract_approval_requested",
        status: "failed",
        createdAt: "2026-09-28T00:00:00Z",
        lastErrorCode: "MessageRejected",
        attempts: 8,
        deadLettered: true,
      },
    ];
    const version = { expectedVersion: 1 };
    const decision = {
      ...version,
      subjectHash: created.value.version.contentHash,
    };
    const reason = { ...version, reason: "Change terms" };
    const terms = termsInputSchema.strip().parse(draft());
    terms.specialClauses = [
      {
        textEn: "Synthetic clause",
        textAr: "نص اصطناعي",
        modelTranslated: true,
        suggestionId: id,
      },
    ];
    const edit = { ...version, terms };
    const cases: {
      method: string;
      path: string;
      body?: unknown;
      response: unknown;
      status?: number;
      command?: boolean;
      call: (api: ContractsApi) => Promise<unknown>;
    }[] = [
      {
        method: "GET",
        path: "/contracts?status=draft&limit=10&cursor=next",
        response: { items: [], nextCursor: null },
        call: (api) =>
          api.list(session, company, {
            status: "draft",
            limit: 10,
            cursor: "next",
          }),
      },
      {
        method: "GET",
        path: `/contracts/${id}`,
        response: created.value,
        call: (api) => api.get(session, company, id),
      },
      {
        method: "GET",
        path: "/contracts/drafting-options",
        response: mockDraftingOptions,
        call: (api) => api.draftingOptions(session, company),
      },
      {
        method: "POST",
        path: "/contracts",
        body: draft(),
        response: created.value,
        status: 201,
        command: true,
        call: (api) => api.create(session, company, draft(), token),
      },
      {
        method: "PUT",
        path: `/contracts/${id}/draft`,
        body: edit,
        response: created.value,
        command: true,
        call: (api) => api.edit(session, company, id, edit, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/submit`,
        body: version,
        response: created.value,
        command: true,
        call: (api) => api.submit(session, company, id, version, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/owner-approval`,
        body: decision,
        response: created.value,
        command: true,
        call: (api) => api.approveOwner(session, company, id, decision, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/owner-return`,
        body: reason,
        response: created.value,
        command: true,
        call: (api) => api.returnOwner(session, company, id, reason, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/tenant-acceptance`,
        body: decision,
        response: created.value,
        command: true,
        call: (api) => api.acceptTenant(session, company, id, decision, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/tenant-return`,
        body: reason,
        response: created.value,
        command: true,
        call: (api) => api.returnTenant(session, company, id, reason, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/withdraw`,
        body: reason,
        response: created.value,
        command: true,
        call: (api) => api.withdraw(session, company, id, reason, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/cancel`,
        body: reason,
        response: created.value,
        command: true,
        call: (api) => api.cancel(session, company, id, reason, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/revisions`,
        body: version,
        response: created.value,
        status: 201,
        command: true,
        call: (api) => api.revise(session, company, id, version, token),
      },
      {
        method: "GET",
        path: "/approvals",
        response: { items: [] },
        call: (api) => api.listApprovals(session, company),
      },
      {
        method: "GET",
        path: "/notifications?limit=10",
        response: { items: [], unreadCount: 0 },
        call: (api) => api.listNotifications(session, company, 10),
      },
      {
        method: "POST",
        path: `/notifications/${id}/read`,
        body: {},
        response: { id, readAt: "2026-09-28T00:00:00Z" },
        command: true,
        call: (api) => api.markNotificationRead(session, company, id, token),
      },
      {
        method: "POST",
        path: `/contracts/${id}/clause-suggestions`,
        body: { textEn: "A clause" },
        response: {
          suggestionId: "60000000-0000-4000-8000-000000000099",
          suggestion: { textAr: "شرط", warnings: [] },
          provenance: {
            registryEntry: "synthetic",
            promptVersion: "1",
            outputSha256: "a".repeat(64),
          },
        },
        command: true,
        call: (api) =>
          api.suggestClause(
            session,
            company,
            id,
            { textEn: "A clause" },
            token,
          ),
      },
    ];
    const timeout = vi.spyOn(AbortSignal, "timeout");
    for (const row of cases) {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(row.response, { status: row.status ?? 200 }),
        );
      expect(
        await row.call(
          createContractsHttp("https://api.example.com", transport),
        ),
      ).toEqual({ ok: true, value: row.response });
      expect(transport).toHaveBeenCalledWith(
        `https://api.example.com/v1/companies/${company}${row.path}`,
        {
          method: row.method,
          headers: {
            Accept: "application/json",
            Authorization: `Session ${session}`,
            ...(row.command ? { "Idempotency-Key": token } : {}),
            ...(row.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(row.body === undefined ? {} : { body: JSON.stringify(row.body) }),
          cache: "no-store",
          redirect: "error",
          signal: expect.any(AbortSignal) as unknown,
        },
      );
    }
    expect(timeout).toHaveBeenCalledWith(10000);
  });
  it("preserves refusal codes and field paths", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          type: "about:blank",
          title: "Invalid",
          status: 409,
          code: "VERSION_CONFLICT",
          field: "expectedVersion",
        },
        { status: 409 },
      ),
    );
    expect(
      await createContractsHttp("https://api.example.com", transport).get(
        session,
        company,
        id,
      ),
    ).toEqual({
      ok: false,
      error: {
        status: 409,
        code: "VERSION_CONFLICT",
        field: "expectedVersion",
      },
    });
  });
  it.each(["network", "timeout", "server", "schema", "json", "wrong-status"])(
    "maps %s failure to unavailable",
    async (failure) => {
      const transport = vi.fn<typeof fetch>();
      if (failure === "network" || failure === "timeout")
        transport.mockRejectedValue(
          new DOMException(
            failure,
            failure === "timeout" ? "TimeoutError" : "NetworkError",
          ),
        );
      else if (failure === "json")
        transport.mockResolvedValue(new Response("invalid"));
      else
        transport.mockResolvedValue(
          Response.json(
            {},
            {
              status:
                failure === "server"
                  ? 500
                  : failure === "wrong-status"
                    ? 201
                    : 200,
            },
          ),
        );
      expect(
        await createContractsHttp("https://api.example.com", transport).get(
          session,
          company,
          id,
        ),
      ).toEqual({ ok: false, error: { status: 503, code: "UNAVAILABLE" } });
    },
  );
  it("mirrors deployment URL and mode validation", () => {
    vi.stubEnv("AQARAK_API_MODE", "http");
    for (const url of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com?q=1",
      "https://example.com#x",
      "invalid",
    ]) {
      vi.stubEnv("AQARAK_API_BASE_URL", url);
      expect(() => getContractsApi()).toThrow();
    }
    for (const url of [
      "https://api.example.com",
      "http://127.0.0.1:8080",
      "http://localhost:8080",
      "http://[::1]:8080",
    ]) {
      vi.stubEnv("AQARAK_API_BASE_URL", url);
      expect(() => getContractsApi()).not.toThrow();
    }
    vi.stubEnv("AQARAK_API_MODE", "invalid");
    expect(() => getContractsApi()).toThrow();
  });
});

it("preserves the documented model-unavailable response", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { status: 503, code: "MODEL_UNAVAILABLE" },
        { status: 503 },
      ),
    );
  expect(
    await createContractsHttp(
      "https://api.example.com",
      transport,
    ).suggestClause(
      session,
      company,
      id,
      { textEn: "Synthetic clause" },
      token,
    ),
  ).toEqual({ ok: false, error: { status: 503, code: "MODEL_UNAVAILABLE" } });
});

it("allows the suggestion gateway timeout while bounding ordinary reads", async () => {
  const timer = vi.spyOn(AbortSignal, "timeout");
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { status: 503, code: "MODEL_UNAVAILABLE" },
        { status: 503 },
      ),
    );
  try {
    const api = createContractsHttp("https://api.example.com", transport);
    await api.suggestClause(
      session,
      company,
      id,
      { textEn: "Synthetic clause" },
      token,
    );
    expect(timer).toHaveBeenLastCalledWith(25_000);
    await api.get(session, company, id);
    expect(timer).toHaveBeenLastCalledWith(10_000);
  } finally {
    timer.mockRestore();
  }
});

it.each(["APPROVALS_REQUIRED", "TENANT_REQUIRED"])(
  "retains documented %s refusals",
  async (code) => {
    const status = code === "TENANT_REQUIRED" ? 422 : 409;
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status, code }, { status }));
    expect(
      await createContractsHttp("https://api.example.com", transport).submit(
        session,
        company,
        id,
        { expectedVersion: 1 },
        token,
      ),
    ).toEqual({ ok: false, error: { status, code } });
  },
);
