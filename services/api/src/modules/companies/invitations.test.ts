import { randomBytes, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { CompanyTransaction } from "@aqarak/db";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { sha256, withIdempotency } from "../identity/database";
import { createLocalIdentityProvider } from "../identity/local-identity-provider";
import { deliverInvitation, invitationReplayBody } from "./invitations";

it.each([201, 200])(
  "stores a token-free invitation replay for status %i and returns the link once",
  async (status) => {
    const token = randomBytes(32).toString("base64url");
    const invitation = { id: randomUUID(), version: 1 };
    const response = {
      status,
      body: { invitation, token, acceptPath: `/en/invitation#${token}` },
    };
    const key = randomUUID();
    const execute = vi
      .fn<CompanyTransaction["execute"]>()
      .mockResolvedValueOnce({
        rows: [{ key }],
        numberOfRecordsUpdated: 1,
      })
      .mockResolvedValue({ rows: [], numberOfRecordsUpdated: 1 });
    const result = await withIdempotency(
      { execute },
      {
        companyId: randomUUID(),
        accountId: randomUUID(),
        command: "invitation",
        key,
        path: {},
        body: {},
      },
      () => Promise.resolve(response),
      invitationReplayBody,
    );
    expect(result).toEqual(response);
    const stored = execute.mock.calls[1]?.[1]?.find(
      (parameter) => parameter.name === "response",
    )?.value;
    expect(stored).toBe(
      JSON.stringify({
        status,
        body: { invitation, token: null, acceptPath: null },
      }),
    );
    expect(JSON.stringify(execute.mock.calls)).not.toContain(token);
  },
);

it.each(["sent", "not_configured", "failed"] as const)(
  "returns the committed invitation version and %s delivery status",
  async (outcome) => {
    const token = randomBytes(32).toString("base64url");
    const company = randomUUID();
    const account = randomUUID();
    const invitation = randomUUID();
    const before = {
      id: invitation,
      token_hash: sha256(token),
      kind: "staff",
      email: "synthetic@example.com",
      staff_roles: ["manager"],
      target_id: null,
      status: "pending",
      expires_at: "2026-10-05T00:00:00Z",
      created_at: "2026-09-28T00:00:00Z",
      delivery_status: "pending",
      version: 3,
      legal_name_en: "Synthetic Company",
      legal_name_ar: "شركة تجريبية",
    };
    const execute = vi
      .fn<DataApiExecutor["execute"]>()
      .mockImplementation((sql) =>
        Promise.resolve({
          rows: sql.startsWith("select id from core.company")
            ? [{ id: company }]
            : sql.startsWith("select i.*")
              ? [before]
              : sql.startsWith("update core.invitation")
                ? [{ ...before, delivery_status: outcome, version: 4 }]
                : [],
          numberOfRecordsUpdated: 0,
        }),
      );
    const commit = vi.fn().mockResolvedValue(undefined);
    const response = await deliverInvitation({
      deps: {
        executor: {
          execute,
          begin: () => Promise.resolve("delivery"),
          commit,
          rollback: () => Promise.resolve(),
        },
        identityProvider: createLocalIdentityProvider({
          confirmationCode: "246810",
        }),
        emailSender: {
          send: () =>
            outcome === "failed"
              ? Promise.reject(new TypeError("Synthetic failure"))
              : Promise.resolve(outcome),
        },
        clock: () => new Date("2026-09-28T00:00:00Z"),
        appOrigin: "http://localhost:3000",
      },
      principal: {
        accountId: account,
        client: "web",
        sessionId: randomUUID(),
        claims: {
          subject: account,
          email: "synthetic@example.com",
          emailVerified: true,
          displayName: "Synthetic Person",
          locale: "en",
        },
      },
      companyId: company,
      response: {
        status: 201,
        body: {
          invitation: { id: invitation, version: 3, deliveryStatus: "pending" },
          token,
          acceptPath: `/en/invitation#${token}`,
        },
      },
      role: "company_administrator",
      permission: {
        method: "POST",
        route: "/v1/companies/:companyId/invitations",
        capability: "staff_memberships",
        operation: "write",
      },
      key: undefined,
    });
    expect(commit).toHaveBeenCalledWith("delivery");
    expect(response).toMatchObject({
      status: 201,
      body: {
        invitation: { id: invitation, version: 4, deliveryStatus: outcome },
        token,
        acceptPath: `/en/invitation#${token}`,
      },
    });
    expect(JSON.stringify(execute.mock.calls)).not.toContain(token);
  },
);
