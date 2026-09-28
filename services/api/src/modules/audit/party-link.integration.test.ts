import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chainLength,
  createFixture,
  type Fixture,
} from "./integration-fixture";
import { coverTransactionVersions, writeAuditEvent } from "./kernel";

// These tests require the explicitly configured development database.
describe.skipIf(process.env.AQARAK_INTEGRATION !== "1")(
  "active party company links",
  { timeout: 120_000 },
  () => {
    let a: Fixture;
    beforeAll(async () => {
      a = await createFixture();
    }, 180_000);
    afterAll(async () => {
      await a.close();
    });

    it.each(["owner", "tenant"] as const)(
      "conceals the company from a %s after revocation and records one denial",
      async (role) => {
        const active = await a.request("/events", { role });
        expect(active.status).toBe(403);
        expect(await active.json()).toMatchObject({ code: "NOT_PERMITTED" });

        await a.tx(async (tx) => {
          const result = await tx.execute(
            "update core.account_company_link set status = 'revoked' where company_id = :company::uuid and account_id = :account::uuid and kind = :kind and status = 'active' returning id",
            [
              { name: "company", value: a.companyId },
              { name: "account", value: a.accounts[role] },
              { name: "kind", value: role },
            ],
          );
          expect(result.rows).toHaveLength(1);
          const event = await writeAuditEvent(tx, a.companyId, {
            eventType: "account_link.revoked",
            actorAccountId: a.accounts.manager,
            actorRole: "manager",
            initiator: "person",
            channel: "web_form",
            subjectType: "company",
            subjectId: a.companyId,
            versionBefore: null,
            versionAfter: null,
          });
          expect(
            await coverTransactionVersions(tx, a.companyId, event.eventId),
          ).toBe(1);
        });

        const before = await chainLength(a);
        const revoked = await a.request("/events", { role });
        expect(revoked.status).toBe(404);
        expect(revoked.headers.get("Cache-Control")).toBe("no-store");
        expect(await revoked.json()).toMatchObject({ code: "NOT_FOUND" });
        expect(await chainLength(a)).toBe(before + 1);
        const latest = await a.tx((tx) =>
          tx.execute(
            "select event_type, actor_account_id, reason from audit.audit_event where company_id = :company::uuid order by seq desc limit 1",
            [{ name: "company", value: a.companyId }],
          ),
        );
        expect(latest.rows).toEqual([
          {
            event_type: "policy.denied",
            actor_account_id: a.accounts[role],
            reason: "NOT_FOUND",
          },
        ]);
      },
    );
  },
);
