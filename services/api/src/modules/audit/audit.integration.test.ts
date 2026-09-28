import { randomUUID } from "node:crypto";
import {
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { sha256Hex } from "@aqarak/domain";
import {
  createFixture,
  chainLength,
  type Fixture,
  type FixtureRole,
} from "./integration-fixture";
import {
  writeAuditEvent,
  coverTransactionVersions,
  runCommand,
  expectVersion,
} from "./kernel";
import { authorizeAudit } from "./index";
import type { AuditEventView } from "./views";
import type { VerificationView, AnchorView } from "./chain";

interface Events {
  events: AuditEventView[];
  nextCursor: number | null;
}
async function responseJson<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return (await response.json()) as T;
}
async function latest(fixture: Fixture): Promise<AuditEventView> {
  const result = await responseJson<Events>(
    await fixture.request("/events?limit=1"),
  );
  const event = result.events[0];
  if (!event) throw new Error("Expected a synthetic audit event");
  return event;
}
async function seedEvent(
  fixture: Fixture,
  subjectId: string,
  reason: string | null = null,
): Promise<void> {
  await fixture.tx(async (tx) => {
    await writeAuditEvent(tx, fixture.companyId, {
      eventType: "test.recorded",
      actorAccountId: fixture.accounts.manager,
      actorRole: "manager",
      initiator: "person",
      channel: "web_form",
      subjectType: "document",
      subjectId,
      versionBefore: null,
      versionAfter: null,
      reason,
    });
  });
}

// These tests require the explicitly configured development database and Object Lock bucket.
describe.skipIf(process.env.AQARAK_INTEGRATION !== "1")(
  "audit integration",
  // The role matrix makes sequential real Data API transactions for every denied route.
  { timeout: 300_000 },
  () => {
    let a: Fixture;
    let b: Fixture;
    beforeAll(async () => {
      a = await createFixture();
      b = await createFixture();
    }, 180_000);
    afterAll(async () => {
      await a.close();
      await b.close();
    });

    it("AC-1 mounts the company parameter and serves manager A", async () => {
      const body = await responseJson<Events>(await a.request("/events"));
      expect(
        body.events.some((event) => event.subject.id === a.companyId),
      ).toBe(true);
      expect(
        body.events.some((event) => event.subject.id === b.companyId),
      ).toBe(false);
    });

    it("AC-2 rejects absent and malformed sessions without changing the chain", async () => {
      const before = await chainLength(a);
      for (const authorization of ["", "Bearer malformed", "Session short"]) {
        const body = await responseJson<{ code: string }>(
          await a.request("/events", { authorization }),
          401,
        );
        expect(body.code).toBe("SESSION_INVALID");
      }
      expect(await chainLength(a)).toBe(before);
    });

    it("AC-3 conceals company A from manager B and does not audit nonexistent companies", async () => {
      const before = await chainLength(a);
      const response = await b.request("/events", { companyId: a.companyId });
      const body = await responseJson<{ code: string }>(response, 404);
      expect(body.code).toBe("NOT_FOUND");
      expect(JSON.stringify(body)).not.toContain(a.companyId);
      expect(await chainLength(a)).toBe(before + 1);
      const denial = await latest(a);
      expect(denial.eventType).toBe("policy.denied");
      expect(denial.actor?.accountId).toBe(b.accounts.manager);
      expect(denial.actor?.displayName).toBeNull();
      expect(denial.details).toEqual({
        code: "NOT_FOUND",
        route: "GET /v1/companies/:companyId/audit/events",
      });
      const missing = randomUUID();
      expect((await b.request("/events", { companyId: missing })).status).toBe(
        404,
      );
      expect(await chainLength(a)).toBe(before + 1);
      const count = await b.tx(async (tx) =>
        tx.execute(
          "select count(*) as count from audit.audit_event where company_id = :id::uuid",
          [{ name: "id", value: missing }],
        ),
      );
      expect(Number(count.rows[0]?.count)).toBe(0);
    });

    it("AC-3 refuses a foreign manager on every remaining route", async () => {
      let count = await chainLength(a);
      for (const [path, method] of [
        [`/subjects/company/${a.companyId}/versions`, "GET"],
        ["/verification", "POST"],
        ["/anchors", "POST"],
        ["/export.csv", "GET"],
        [`/events/${randomUUID()}`, "PATCH"],
        [`/events/${randomUUID()}`, "DELETE"],
      ] as const) {
        const response = await b.request(path, {
          companyId: a.companyId,
          method,
          ...(method === "POST" ? { body: {}, key: randomUUID() } : {}),
        });
        expect(response.status).toBe(404);
        count += 1;
        expect(await chainLength(a)).toBe(count);
      }
    });

    it("AC-4 denies every non-company capacity on all five routes with one event each", async () => {
      let expectedCount = await chainLength(a);
      for (const role of [
        "accountant",
        "owner",
        "tenant",
        "technician",
      ] as FixtureRole[]) {
        for (const path of [
          "/events",
          `/subjects/company/${a.companyId}/versions`,
          "/verification",
          "/anchors",
          "/export.csv",
        ]) {
          const post = path === "/verification" || path === "/anchors";
          const response = await a.request(path, {
            role,
            ...(post ? { method: "POST", body: {}, key: randomUUID() } : {}),
          });
          const body = await responseJson<{ code: string }>(response, 403);
          expect(body.code).toBe("NOT_PERMITTED");
          expectedCount += 1;
          const state = await a.tx((tx) =>
            tx.execute(
              "select (select count(*) from audit.audit_event where company_id = :company::uuid) as count, event_type, actor_account_id from audit.audit_event where company_id = :company::uuid order by seq desc limit 1",
              [{ name: "company", value: a.companyId }],
            ),
          );
          expect(Number(state.rows[0]?.count)).toBe(expectedCount);
          expect(state.rows[0]?.event_type).toBe("policy.denied");
          expect(state.rows[0]?.actor_account_id).toBe(a.accounts[role]);
        }
      }
    });

    it("AC-4 grants manager and administrator each audit route", async () => {
      for (const role of ["manager", "administrator"] as const) {
        expect((await a.request("/events", { role })).status).toBe(200);
        expect(
          (
            await a.request(`/subjects/company/${a.companyId}/versions`, {
              role,
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await a.request("/verification", {
              role,
              method: "POST",
              body: {},
              key: randomUUID(),
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await a.request("/anchors", {
              role,
              method: "POST",
              body: {},
              key: randomUUID(),
            })
          ).status,
        ).toBe(201);
        expect((await a.request("/export.csv", { role })).status).toBe(200);
      }
    });

    it("AC-5 filters subjects, actors, types, initiators and refusals, with disjoint descending pages", async () => {
      const first = randomUUID();
      const second = randomUUID();
      await seedEvent(a, first);
      await seedEvent(a, second);
      await seedEvent(a, first);
      const filtered = await responseJson<Events>(
        await a.request(
          `/events?subjectType=document&subjectId=${first}&actorAccountId=${a.accounts.manager}&eventType=test.recorded&initiator=person`,
        ),
      );
      expect(filtered.events).toHaveLength(2);
      expect(filtered.events.every((event) => event.subject.id === first)).toBe(
        true,
      );
      const refusals = await responseJson<Events>(
        await a.request("/events?refusalsOnly=true"),
      );
      expect(refusals.events.length).toBeGreaterThan(0);
      expect(refusals.events.every((event) => event.refused)).toBe(true);
      const page1 = await responseJson<Events>(
        await a.request("/events?limit=2"),
      );
      const page2 = await responseJson<Events>(
        await a.request(`/events?limit=2&afterSeq=${String(page1.nextCursor)}`),
      );
      const sequences = [...page1.events, ...page2.events].map(
        (event) => event.seq,
      );
      expect(new Set(sequences).size).toBe(4);
      expect(sequences).toEqual(
        sequences.toSorted((left, right) => right - left),
      );
      for (const limit of [0, 101])
        expect((await a.request(`/events?limit=${String(limit)}`)).status).toBe(
          400,
        );
    });

    it("AC-6 returns two real record versions with covering events and the exact business diff", async () => {
      const record = randomUUID();
      const contract = randomUUID();
      await a.tx(async (tx) => {
        const params = [
          { name: "company", value: a.companyId },
          { name: "contract", value: contract },
          { name: "record", value: record },
        ];
        await tx.execute(
          "insert into lease.contract(id, company_id, contract_no, tenant_id, status, origin) select :contract::uuid, :company::uuid, :contract, id, 'draft', 'app' from party.tenant where company_id = :company::uuid limit 1",
          params,
        );
        await tx.execute(
          "insert into lease.tawtheeq_record(id, company_id, contract_id, path, workflow_state, portal_status) values (:record::uuid, :company::uuid, :contract::uuid, 'normal', 'awaiting_registration', 'not_started')",
          params,
        );
        const event = await writeAuditEvent(tx, a.companyId, {
          eventType: "tawtheeq.created",
          actorAccountId: a.accounts.manager,
          actorRole: "manager",
          initiator: "person",
          channel: "web_form",
          subjectType: "tawtheeq_record",
          subjectId: record,
          versionBefore: null,
          versionAfter: 1,
        });
        await coverTransactionVersions(tx, a.companyId, event.eventId);
      });
      await a.tx(async (tx) => {
        await tx.execute(
          "update lease.tawtheeq_record set workflow_state = 'under_review' where company_id = :company::uuid and id = :record::uuid",
          [
            { name: "company", value: a.companyId },
            { name: "record", value: record },
          ],
        );
        const event = await writeAuditEvent(tx, a.companyId, {
          eventType: "tawtheeq.updated",
          actorAccountId: a.accounts.manager,
          actorRole: "manager",
          initiator: "person",
          channel: "web_form",
          subjectType: "tawtheeq_record",
          subjectId: record,
          versionBefore: 1,
          versionAfter: 2,
        });
        await coverTransactionVersions(tx, a.companyId, event.eventId);
      });
      const history = await responseJson<{
        versions: {
          version: number;
          event: { seq: number; eventType: string };
          diff: { field: string; before: string; after: string }[];
        }[];
      }>(await a.request(`/subjects/tawtheeq_record/${record}/versions`));
      expect(history.versions.map((version) => version.version)).toEqual([
        1, 2,
      ]);
      expect(history.versions[1]?.diff).toEqual([
        {
          field: "workflow_state",
          before: "awaiting_registration",
          after: "under_review",
        },
      ]);
      expect(
        history.versions.map((version) => version.event.eventType),
      ).toEqual(["tawtheeq.created", "tawtheeq.updated"]);
      expect(history.versions[1]?.event.seq).toBeGreaterThan(
        history.versions[0]?.event.seq ?? 0,
      );
      expect(
        (await b.request(`/subjects/tawtheeq_record/${record}/versions`))
          .status,
      ).toBe(404);
      expect(
        (await a.request(`/subjects/unknown/${record}/versions`)).status,
      ).toBe(400);
    });

    it("AC-7 verifies SQL and TypeScript against the locked anchor and appends one event", async () => {
      const before = await chainLength(a);
      const result = await responseJson<VerificationView>(
        await a.request("/verification", {
          method: "POST",
          body: {},
          key: randomUUID(),
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        eventCount: before,
        lastSeq: before,
        sql: { ok: true },
        recomputed: { ok: true, break: null },
        anchorProblem: null,
      });
      expect(result.anchor).not.toBeNull();
      expect(await chainLength(a)).toBe(before + 1);
      expect((await latest(a)).eventType).toBe("chain.verified");
    });

    it("AC-8 anchors with Object Lock, replays without writes and serializes duplicates", async () => {
      const key = randomUUID();
      const before = await chainLength(a);
      const first = await responseJson<AnchorView>(
        await a.request("/anchors", { method: "POST", body: {}, key }),
        201,
      );
      expect(
        first.key.startsWith(
          `${a.deps.keyPrefix}companies/${a.companyId}/audit-anchors/`,
        ),
      ).toBe(true);
      const head = await a.deps.s3.send(
        new HeadObjectCommand({
          Bucket: a.deps.buckets.auditAnchors ?? undefined,
          Key: first.key,
          VersionId: first.objectVersionId,
        }),
      );
      expect(head.ObjectLockMode).toBeTruthy();
      expect(head.ObjectLockRetainUntilDate).toBeInstanceOf(Date);
      const replay = await a.request("/anchors", {
        method: "POST",
        body: {},
        key,
      });
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await responseJson<AnchorView>(replay, 201)).toEqual(first);
      expect(await chainLength(a)).toBe(before + 1);
      const versions = await a.deps.s3.send(
        new ListObjectVersionsCommand({
          Bucket: a.deps.buckets.auditAnchors ?? undefined,
          Prefix: first.key,
        }),
      );
      expect(
        versions.Versions?.filter((version) => version.Key === first.key),
      ).toHaveLength(1);
      const rows = await a.tx((tx) =>
        tx.execute(
          "select count(*) as count from audit.chain_anchor where company_id = :company::uuid and seq = :seq::bigint",
          [
            { name: "company", value: a.companyId },
            { name: "seq", value: first.seq },
          ],
        ),
      );
      expect(Number(rows.rows[0]?.count)).toBe(1);
      const concurrentKey = randomUUID();
      const responses = await Promise.all([
        a.request("/anchors", { method: "POST", body: {}, key: concurrentKey }),
        a.request("/anchors", { method: "POST", body: {}, key: concurrentKey }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(
        responses.filter(
          (response) => response.headers.get("Idempotency-Replayed") === "true",
        ),
      ).toHaveLength(1);
      expect(await responses[0].json()).toEqual(await responses[1].json());
      expect(await chainLength(a)).toBe(before + 2);
      expect(
        (
          await a.request("/anchors", {
            method: "POST",
            body: { unexpected: true },
            key,
          })
        ).status,
      ).toBe(400);
    });

    it("AC-8 rejects a changed validated command body and authorizes before replay", async () => {
      const routes = new Hono();
      routes.post("/test-command", async (c) => {
        const body = z
          .strictObject({ value: z.string() })
          .parse(await c.req.json<unknown>());
        return runCommand(c, a.deps, {
          commandType: "test.idempotency",
          body,
          authorize: authorizeAudit,
          async execute(ctx) {
            await writeAuditEvent(ctx.tx, ctx.companyId, {
              eventType: "test.committed",
              actorAccountId: ctx.actor.account_id,
              actorRole: "manager",
              initiator: "person",
              channel: ctx.channel,
              subjectType: "company",
              subjectId: ctx.companyId,
              versionBefore: null,
              versionAfter: null,
            });
            return { status: 200, body };
          },
        });
      });
      const application = new Hono();
      application.route("/v1/companies/:companyId/audit", routes);
      const key = randomUUID();
      expect(
        (
          await a.request("/test-command", {
            application,
            method: "POST",
            body: { value: "first" },
            key,
          })
        ).status,
      ).toBe(200);
      const refusal = await responseJson<{ code: string }>(
        await a.request("/test-command", {
          application,
          method: "POST",
          body: { value: "second" },
          key,
        }),
        422,
      );
      expect(refusal.code).toBe("IDEMPOTENCY_KEY_REUSED");
      const before = await chainLength(a);
      expect(
        (
          await a.request("/test-command", {
            application,
            method: "POST",
            body: { value: "first" },
            key,
            role: "accountant",
          })
        ).status,
      ).toBe(403);
      expect(await chainLength(a)).toBe(before + 1);
    });

    it("AC-8 checks changed membership before replaying the same caller's response", async () => {
      const key = randomUUID();
      expect(
        (await b.request("/anchors", { method: "POST", body: {}, key })).status,
      ).toBe(201);
      async function changeRole(manager: boolean): Promise<void> {
        await b.tx(async (tx) => {
          await tx.execute(
            "update core.membership set is_manager = :manager, is_accountant = :accountant where company_id = :company::uuid and account_id = :account::uuid",
            [
              { name: "manager", value: manager },
              { name: "accountant", value: !manager },
              { name: "company", value: b.companyId },
              { name: "account", value: b.accounts.manager },
            ],
          );
          const event = await writeAuditEvent(tx, b.companyId, {
            eventType: "membership.changed",
            actorAccountId: b.accounts.manager,
            actorRole: null,
            initiator: "person",
            channel: "web_form",
            subjectType: "company",
            subjectId: b.companyId,
            versionBefore: null,
            versionAfter: null,
          });
          await coverTransactionVersions(tx, b.companyId, event.eventId);
        });
      }
      await changeRole(false);
      try {
        const before = await chainLength(b);
        const response = await b.request("/anchors", {
          method: "POST",
          body: {},
          key,
        });
        expect(response.status).toBe(403);
        expect(response.headers.get("Idempotency-Replayed")).toBeNull();
        expect(await chainLength(b)).toBe(before + 1);
      } finally {
        await changeRole(true);
      }
    });

    it("AC-7 validates command keys and persists request tracing and the mobile channel", async () => {
      for (const key of ["", "has space", "x".repeat(129)]) {
        expect(
          (await a.request("/verification", { method: "POST", body: {}, key }))
            .status,
        ).toBe(400);
      }
      const traceId = randomUUID();
      const response = await a.request("/verification", {
        method: "POST",
        body: {},
        key: "x",
        headers: { "X-Request-Id": traceId, "X-Aqarak-Channel": "mobile_form" },
      });
      expect(response.status).toBe(200);
      const last = await a.tx((tx) =>
        tx.execute(
          "select trace_id, channel from audit.audit_event where company_id = :company::uuid order by seq desc limit 1",
          [{ name: "company", value: a.companyId }],
        ),
      );
      expect(last.rows[0]).toEqual({
        trace_id: traceId,
        channel: "mobile_form",
      });
    });

    it("AC-10 rejects SQL changes and audits HTTP edit attempts without changing the target", async () => {
      const target = await latest(a);
      for (const sql of [
        "update audit.audit_event set reason = 'x' where event_id = :id::uuid",
        "delete from audit.audit_event where event_id = :id::uuid",
      ]) {
        await expect(
          a.tx((tx) =>
            tx.execute(sql, [{ name: "id", value: target.eventId }]),
          ),
        ).rejects.toThrow();
      }
      const before = await chainLength(a);
      for (const method of ["PATCH", "DELETE"]) {
        const response = await responseJson<{ code: string }>(
          await a.request(`/events/${target.eventId}`, { method }),
          405,
        );
        expect(response.code).toBe("METHOD_NOT_ALLOWED");
        expect((await latest(a)).subject).toMatchObject({
          type: "audit_event",
          id: target.eventId,
        });
      }
      expect(await chainLength(a)).toBe(before + 2);
      const row = await a.tx((tx) =>
        tx.execute(
          "select reason, row_hash from audit.audit_event where company_id = :company::uuid and event_id = :id::uuid",
          [
            { name: "company", value: a.companyId },
            { name: "id", value: target.eventId },
          ],
        ),
      );
      expect(row.rows[0]).toEqual({
        reason: target.reason,
        row_hash: target.rowHash,
      });
    });

    it("AC-11 exports BOM, guarded Arabic text and an event containing the exact body hash", async () => {
      const subject = randomUUID();
      await seedEvent(a, subject, '=SUM(1,2) عقار "اختبار"');
      const before = await chainLength(a);
      const response = await a.request(`/export.csv?subjectId=${subject}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/csv; charset=utf-8",
      );
      expect(response.headers.get("Content-Disposition")).toMatch(
        /attachment; filename="audit-.+-\d{8}T\d{6}Z.csv"/,
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
      const csv = bytes.toString("utf8");
      expect(csv).toContain('"\'=SUM(1,2) عقار ""اختبار"""');
      expect(csv.split("\r\n")).toHaveLength(3);
      expect(await chainLength(a)).toBe(before + 1);
      expect(await latest(a)).toMatchObject({
        eventType: "export.performed",
        details: { rows: 1, sha256: sha256Hex(csv) },
      });
    });

    it("AC-12 covers two business versions with one event and rolls back missing coverage", async () => {
      const ids = [randomUUID(), randomUUID()];
      let eventId = "";
      await a.tx(async (tx) => {
        for (const id of ids)
          await tx.execute(
            "insert into party.owner(id, company_id, full_name_en) values (:id::uuid, :company::uuid, 'Synthetic coverage owner')",
            [
              { name: "id", value: id },
              { name: "company", value: a.companyId },
            ],
          );
        const event = await writeAuditEvent(tx, a.companyId, {
          eventType: "test.covered",
          actorAccountId: a.accounts.manager,
          actorRole: "manager",
          initiator: "person",
          channel: "web_form",
          subjectType: "company",
          subjectId: a.companyId,
          versionBefore: null,
          versionAfter: null,
        });
        eventId = event.eventId;
        expect(await coverTransactionVersions(tx, a.companyId, eventId)).toBe(
          2,
        );
      });
      const links = await a.tx((tx) =>
        tx.execute(
          "select count(*) as count from audit.event_subject where company_id = :company::uuid and event_id = :event::uuid",
          [
            { name: "company", value: a.companyId },
            { name: "event", value: eventId },
          ],
        ),
      );
      expect(Number(links.rows[0]?.count)).toBe(2);
      const failed = [randomUUID(), randomUUID()];
      await expect(
        a.tx(async (tx) => {
          for (const id of failed)
            await tx.execute(
              "insert into party.owner(id, company_id, full_name_en) values (:id::uuid, :company::uuid, 'Synthetic uncovered owner')",
              [
                { name: "id", value: id },
                { name: "company", value: a.companyId },
              ],
            );
          await writeAuditEvent(tx, a.companyId, {
            eventType: "test.uncovered",
            actorAccountId: a.accounts.manager,
            actorRole: "manager",
            initiator: "person",
            channel: "web_form",
            subjectType: "company",
            subjectId: a.companyId,
            versionBefore: null,
            versionAfter: null,
          });
        }),
      ).rejects.toThrow(/AQ002/);
      const persisted = await a.tx((tx) =>
        tx.execute(
          "select count(*) as count from party.owner where id in (:first::uuid, :second::uuid)",
          [
            { name: "first", value: failed[0] ?? "" },
            { name: "second", value: failed[1] ?? "" },
          ],
        ),
      );
      expect(Number(persisted.rows[0]?.count)).toBe(0);
    });

    it("AC-13 refuses a stale command, preserves the row and writes one denial", async () => {
      const routes = new Hono();
      routes.post("/test-stale", async (c) => {
        const body = z
          .strictObject({ expectedVersion: z.number().int().positive() })
          .parse(await c.req.json<unknown>());
        return runCommand(c, a.deps, {
          commandType: "test.stale",
          body,
          authorize: authorizeAudit,
          async execute(ctx) {
            const row = await ctx.tx.execute(
              "select version from core.company where id = :id::uuid",
              [{ name: "id", value: ctx.companyId }],
            );
            const actual = Number(row.rows[0]?.version);
            expectVersion(actual, body.expectedVersion, {
              type: "company",
              id: ctx.companyId,
            });
            await ctx.tx.execute(
              "update core.company set legal_name_en = 'Synthetic changed' where id = :id::uuid",
              [{ name: "id", value: ctx.companyId }],
            );
            return { status: 200, body: {} };
          },
        });
      });
      const application = new Hono();
      application.route("/v1/companies/:companyId/audit", routes);
      const before = await chainLength(a);
      const response = await responseJson<{ code: string }>(
        await a.request("/test-stale", {
          application,
          method: "POST",
          body: { expectedVersion: 999 },
          key: randomUUID(),
        }),
        409,
      );
      expect(response.code).toBe("STALE_VERSION");
      expect(await chainLength(a)).toBe(before + 1);
      expect((await latest(a)).details.code).toBe("STALE_VERSION");
      const row = await a.tx((tx) =>
        tx.execute(
          "select version, legal_name_en from core.company where id = :id::uuid",
          [{ name: "id", value: a.companyId }],
        ),
      );
      expect(
        z
          .strictObject({
            version: z.coerce.number().int(),
            legal_name_en: z.string(),
          })
          .parse(row.rows[0]),
      ).toEqual({
        version: 1,
        legal_name_en: "Synthetic audit company",
      });
    });
  },
);
