import { createModelGateway } from "../../../models/gateway";
import { loadModelRegistry } from "../../../models/registry";
import { ZERO_USAGE } from "../../../models/cost";
import { Hono } from "hono";
import { vi } from "vitest";
import { seedDemo } from "../scripts/seed-demo";
import { runContractSmoke } from "../scripts/smoke";
import { createWorkflowModules } from "../workflows";
import { deliverPendingEmails } from "../../notifications/relay";
import { termsSchema } from "../schema";
import { z } from "zod";
import {
  integrationExecutor,
  seed,
  draft,
  request,
  object,
  companyRows,
  createDraftFixture,
  expectRefusal,
  eventCount,
} from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { withCompanyTx, withSystemTx } from "../runtime/db";
import { describe, expect, it } from "vitest";
import { parameters, rows } from "../runtime/sql";

// Database tests require an explicit integration run and a named development database.
const integration =
  process.env.AQARAK_WORKFLOW_INTEGRATION === "1" &&
  Boolean(process.env.AQARAK_IT_DATABASE_NAME);
describe.skipIf(!integration)("development database workflow", () => {
  it("supports conflict-safe idempotency inserts under the application role", async () => {
    const executor = integrationExecutor();
    const companyId = randomUUID();
    const accountId = randomUUID();
    const marker = new Error("Rollback synthetic platform probe");
    await expect(
      withCompanyTx(executor, { companyId, accountId }, async (tx) => {
        await tx.execute(
          "insert into core.company(id,kind,legal_name_en,is_demo) values (:company::uuid,'management_company','Synthetic platform probe',true)",
          parameters({ company: companyId }),
        );
        await tx.execute(
          "insert into core.person_account(id,auth_subject,email,display_name,preferred_language) values (:id::uuid,:id,:email,'Synthetic platform probe','en')",
          parameters({
            id: accountId,
            email: `synthetic-${accountId}@example.invalid`,
          }),
        );
        const sql =
          "insert into ops.idempotency_key(company_id,account_id,command_type,key,request_sha256) values (:company::uuid,:account::uuid,'probe','synthetic_platform_key',repeat('a',64)) on conflict do nothing returning request_sha256";
        const params = parameters({ company: companyId, account: accountId });
        expect((await tx.execute(sql, params)).rows).toHaveLength(1);
        expect((await tx.execute(sql, params)).rows).toHaveLength(0);
        throw marker;
      }),
    ).rejects.toBe(marker);
  }, 60_000);
});

// Database tests require an explicit integration run and a named development database.
describe.skipIf(!integration)("contract approval transactions", () => {
  // I allow four minutes for the sequential development Data API round trips.
  it("concludes a contract through distinct manager, owner and tenant approvals", async () => {
    const f = await seed();
    const created = await request(f, f.manager, "/contracts", {
      body: draft(f),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const contract = object(created.body.contract);
    const id = z.string().parse(contract.id);
    expect(contract).toMatchObject({
      contractNo: "C-01",
      status: "draft",
      currentVersionNo: 1,
    });
    const detailReply = await request(f, f.manager, `/contracts/${id}`);
    expect(detailReply.status).toBe(200);
    expect(object(detailReply.body.version).specialClauses).toEqual([
      {
        position: 1,
        textEn: "Synthetic special clause.",
        textAr: "شرط خاص اصطناعي.",
        modelTranslated: false,
        suggestion: null,
      },
    ]);
    const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
      body: { expectedVersion: 1 },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(object(submitted.body.contract).status).toBe(
      "awaiting_owner_approval",
    );
    expect(object(submitted.body.version).frozenOwnerGate).toBe(true);
    const subjectHash = object(submitted.body.version).contentHash;
    const approved = await request(
      f,
      f.owner,
      `/contracts/${id}/owner-approval`,
      { body: { expectedVersion: 1, subjectHash } },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(object(approved.body.contract).status).toBe(
      "awaiting_tenant_acceptance",
    );
    const accepted = await request(
      f,
      f.tenant,
      `/contracts/${id}/tenant-acceptance`,
      { body: { expectedVersion: 1, subjectHash } },
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(object(accepted.body.contract).status).toBe("concluded");
    expect(accepted.body.tawtheeq).toEqual({
      workflowState: "awaiting_registration",
      portalStatus: "not_started",
    });
    const approvals = await companyRows(
      f,
      "select count(*) as count,count(distinct approver_account_id) as people,count(distinct subject_hash) as hashes from lease.approval where status='approved'",
    );
    expect(approvals[0]).toMatchObject({
      count: "3",
      people: "3",
      hashes: "1",
    });
    expect(
      (
        await companyRows(
          f,
          `select * from audit.verify_chain('${f.companyId}'::uuid)`,
        )
      )[0]?.ok,
    ).toBe(true);
  }, 240_000);
});

// Database tests require an explicit integration run and a named development database.
describe.skipIf(!integration)("contract workflow guards", () => {
  it.each([{ gate: false }, { selfManaged: true }])(
    "bypasses owner approval under the configured gate %j",
    async (options) => {
      const { f, id } = await createDraftFixture(options);
      const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
        body: { expectedVersion: 1 },
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      expect(object(submitted.body.contract).status).toBe(
        "awaiting_tenant_acceptance",
      );
      expect(object(submitted.body.version).frozenOwnerGate).toBe(false);
      const recipients = await companyRows(
        f,
        "select recipient_account_id from work.notification",
      );
      expect(recipients).toHaveLength(2);
      expect(recipients.every((r) => r.recipient_account_id === f.tenant)).toBe(
        true,
      );
    },
    180_000,
  );
  it("refuses commands from the wrong role and hides contracts from technicians", async () => {
    const { f, id } = await createDraftFixture();
    await expectRefusal(
      f,
      () =>
        request(f, f.tenant, `/contracts/${id}/submit`, {
          body: { expectedVersion: 1 },
        }),
      "FORBIDDEN",
    );
    const terms = termsSchema.parse(
      Object.fromEntries(
        Object.entries(draft(f)).filter(
          ([key]) => !["tenantId", "unitId"].includes(key),
        ),
      ),
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.owner, `/contracts/${id}/draft`, {
          method: "PUT",
          body: { expectedVersion: 1, terms },
        }),
      "FORBIDDEN",
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.accountant, `/contracts/${id}/owner-approval`, {
          body: { expectedVersion: 1, subjectHash: "a".repeat(64) },
        }),
      "FORBIDDEN",
    );
    await expectRefusal(
      f,
      () => request(f, f.technician, `/contracts/${id}`),
      "NOT_FOUND",
    );
  }, 180_000);
  it("isolates company context and another tenant's contract", async () => {
    const { f, id } = await createDraftFixture();
    const other = await seed();
    await expectRefusal(
      f,
      () => request(f, other.manager, `/contracts/${id}`),
      "NOT_FOUND",
    );
    await expectRefusal(
      f,
      () =>
        request(f, other.manager, `/contracts/${id}/submit`, {
          body: { expectedVersion: 1 },
        }),
      "NOT_FOUND",
    );
    expect(
      (
        await companyRows(
          f,
          "select subject_type from audit.audit_event order by seq desc limit 1",
        )
      )[0]?.subject_type,
    ).toBe("company");
    await expectRefusal(
      f,
      () => request(f, f.otherTenant, `/contracts/${id}`),
      "NOT_FOUND",
    );
    const missing = { ...f, companyId: randomUUID() };
    const count = await eventCount(f);
    expect((await request(missing, f.manager, "/contracts")).status).toBe(404);
    expect(await eventCount(f)).toBe(count);
  }, 180_000);
  it("refuses an inconsistent schedule, missing reason and unknown tenant without business changes", async () => {
    const f = await seed();
    const input = draft(f);
    input.totalFils += 1;
    const created = await request(f, f.manager, "/contracts", { body: input });
    expect(created.status).toBe(201);
    const id = z.string().parse(object(created.body.contract).id);
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${id}/submit`, {
          body: { expectedVersion: 1 },
        }),
      "SCHEDULE_TOTAL_MISMATCH",
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${id}/cancel`, {
          body: { expectedVersion: 1 },
        }),
      "REASON_REQUIRED",
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, "/contracts", {
          body: { ...draft(f), tenantId: randomUUID() },
        }),
      "TENANT_REQUIRED",
    );
  }, 180_000);
  it("replays a completed command and refuses a reused key with different input", async () => {
    const { f, id } = await createDraftFixture();
    const key = randomUUID();
    const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
      key,
      body: { expectedVersion: 1 },
    });
    expect(submitted.status).toBe(200);
    const events = await eventCount(f);
    const notifications = await companyRows(
      f,
      "select id from work.notification order by id",
    );
    const replay = await request(f, f.manager, `/contracts/${id}/submit`, {
      key,
      body: { expectedVersion: 1 },
    });
    expect(replay).toEqual(submitted);
    expect(await eventCount(f)).toBe(events);
    expect(
      await companyRows(f, "select id from work.notification order by id"),
    ).toEqual(notifications);
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${id}/submit`, {
          key,
          body: { expectedVersion: 2 },
        }),
      "IDEMPOTENCY_KEY_REUSED",
    );
  }, 180_000);
  it("refuses stale draft versions and stale approval hashes", async () => {
    const { f, id } = await createDraftFixture();
    const input = draft(f);
    const terms = termsSchema.parse(
      Object.fromEntries(
        Object.entries(input).filter(
          ([key]) => !["tenantId", "unitId"].includes(key),
        ),
      ),
    );
    const edited = await request(f, f.manager, `/contracts/${id}/draft`, {
      method: "PUT",
      body: { expectedVersion: 1, terms: { ...terms, termEnd: "2027-10-01" } },
    });
    expect(edited.status).toBe(200);
    expect(object(edited.body.contract).currentVersionNo).toBe(2);
    expect(
      (await companyRows(f, "select occupancy_end from lease.contract_unit"))[0]
        ?.occupancy_end,
    ).toBe("2027-10-01");
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${id}/draft`, {
          method: "PUT",
          body: { expectedVersion: 1, terms },
        }),
      "VERSION_CONFLICT",
    );
    expect(
      (
        await request(f, f.manager, `/contracts/${id}/submit`, {
          body: { expectedVersion: 2 },
        })
      ).status,
    ).toBe(200);
    await expectRefusal(
      f,
      () =>
        request(f, f.owner, `/contracts/${id}/owner-approval`, {
          body: { expectedVersion: 2, subjectHash: "a".repeat(64) },
        }),
      "STALE_SUBJECT_HASH",
    );
  }, 180_000);
  it("serializes concurrent submissions and creates one manager approval", async () => {
    const { f, id } = await createDraftFixture();
    const replies = await Promise.all([
      request(f, f.manager, `/contracts/${id}/submit`, {
        body: { expectedVersion: 1 },
      }),
      request(f, f.manager, `/contracts/${id}/submit`, {
        body: { expectedVersion: 1 },
      }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await companyRows(
        f,
        "select id from lease.approval where slot='manager'",
      ),
    ).toHaveLength(1);
  }, 180_000);
  it("requires distinct people and the actor's own approval slot", async () => {
    const { f, id } = await createDraftFixture({ sharedOwner: true });
    const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
      body: { expectedVersion: 1 },
    });
    expect(submitted.status).toBe(200);
    const subjectHash = object(submitted.body.version).contentHash;
    await expectRefusal(
      f,
      () =>
        request(f, f.owner, `/contracts/${id}/owner-approval`, {
          body: { expectedVersion: 1, subjectHash },
        }),
      "APPROVER_NOT_DISTINCT",
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.owner, `/contracts/${id}/tenant-acceptance`, {
          body: { expectedVersion: 1, subjectHash },
        }),
      "FORBIDDEN",
    );
  }, 180_000);
  it("cancels an owner return, releases occupancy and permits one copied revision", async () => {
    const { f, id } = await createDraftFixture();
    expect(
      (
        await request(f, f.manager, `/contracts/${id}/submit`, {
          body: { expectedVersion: 1 },
        })
      ).status,
    ).toBe(200);
    const returnKey = randomUUID();
    await expectRefusal(
      f,
      () =>
        request(f, f.owner, `/contracts/${id}/owner-return`, {
          key: returnKey,
          body: { expectedVersion: 1 },
        }),
      "REASON_REQUIRED",
    );
    const returned = await request(
      f,
      f.owner,
      `/contracts/${id}/owner-return`,
      {
        key: returnKey,
        body: {
          expectedVersion: 1,
          reason: "Synthetic terms require correction",
        },
      },
    );
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(object(returned.body.contract)).toMatchObject({
      status: "cancelled",
      cancelKind: "returned_by_owner",
    });
    const approvals = await companyRows(
      f,
      "select status,reason from lease.approval",
    );
    expect(
      approvals.every(
        (a) => a.status === "voided" && a.reason === "contract_cancelled",
      ),
    ).toBe(true);
    expect(
      (await companyRows(f, "select blocks_unit from lease.contract_unit"))[0]
        ?.blocks_unit,
    ).toBe(false);
    expect(
      await companyRows(
        f,
        `select id from work.notification where recipient_account_id='${f.manager}'::uuid and template_code='contract_cancelled'`,
      ),
    ).toHaveLength(2);
    const revision = await request(f, f.manager, `/contracts/${id}/revisions`, {
      body: { expectedVersion: 1 },
    });
    expect(revision.status, JSON.stringify(revision.body)).toBe(201);
    expect(object(revision.body.contract)).toMatchObject({
      status: "draft",
      revisionOfId: id,
      contractNo: "C-02",
    });
    expect(object(revision.body.version).contentHash).toBe(
      object(returned.body.version).contentHash,
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${id}/revisions`, {
          body: { expectedVersion: 1 },
        }),
      "SUCCESSOR_EXISTS",
    );
  }, 180_000);
  it("refuses an overlapping blocking contract without changing its draft", async () => {
    const { f, id } = await createDraftFixture();
    expect(
      (
        await request(f, f.manager, `/contracts/${id}/submit`, {
          body: { expectedVersion: 1 },
        })
      ).status,
    ).toBe(200);
    const second = await request(f, f.manager, "/contracts", {
      body: draft(f),
    });
    expect(second.status).toBe(201);
    const secondId = z.string().parse(object(second.body.contract).id);
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${secondId}/submit`, {
          body: { expectedVersion: 1 },
        }),
      "OVERLAPPING_CONTRACT",
    );
  }, 180_000);
  it("lists own pending approvals and isolates notification reads", async () => {
    const { f, id } = await createDraftFixture();
    expect(
      (
        await request(f, f.manager, `/contracts/${id}/submit`, {
          body: { expectedVersion: 1 },
        })
      ).status,
    ).toBe(200);
    const queue = await request(f, f.owner, "/approvals");
    expect(queue.status).toBe(200);
    expect(z.array(z.unknown()).parse(queue.body.items)).toHaveLength(1);
    const inbox = await request(f, f.owner, "/notifications");
    expect(inbox.status).toBe(200);
    expect(inbox.body.unreadCount).toBe(1);
    const notification = z
      .array(z.record(z.string(), z.unknown()))
      .parse(inbox.body.items)[0];
    const notificationId = z.string().parse(notification?.id);
    const read = await request(
      f,
      f.owner,
      `/notifications/${notificationId}/read`,
      { body: {} },
    );
    expect(read.status).toBe(200);
    expect(read.body.readAt).toBe("2026-09-28T06:00:00.000Z");
    expect((await request(f, f.owner, "/notifications")).body.unreadCount).toBe(
      0,
    );
    expect((await request(f, f.tenant, "/notifications")).body.items).toEqual(
      [],
    );
    await expectRefusal(
      f,
      () =>
        request(f, f.tenant, `/notifications/${notificationId}/read`, {
          body: {},
        }),
      "NOT_FOUND",
    );
  }, 180_000);
  it("requires accepted tenant documents and allows a corrected retry of a refused key", async () => {
    const { f, id } = await createDraftFixture({ documents: false });
    const key = randomUUID();
    await expectRefusal(
      f,
      () =>
        request(f, f.manager, `/contracts/${id}/submit`, {
          key,
          body: { expectedVersion: 1 },
        }),
      "TENANT_DOCUMENTS_REQUIRED",
    );
    expect(
      await companyRows(
        f,
        `select key from ops.idempotency_key where key='${key}'`,
      ),
    ).toHaveLength(0);
    const corrected = await request(f, f.manager, `/contracts/${id}/cancel`, {
      key,
      body: { expectedVersion: 1, reason: "Synthetic correction" },
    });
    expect(corrected.status).toBe(200);
  }, 180_000);
});

// Database evidence requires an explicit integration run and a named development database.
describe.skipIf(!integration)(
  "audit and notification database evidence",
  () => {
    it("covers every version once, preserves an immutable chain and queues IDs-only email work", async () => {
      const { f, id } = await createDraftFixture();
      const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
        body: { expectedVersion: 1 },
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      const pending = await companyRows(
        f,
        "select channel,status,recipient_account_id,language from work.notification order by channel",
      );
      expect(pending).toEqual([
        {
          channel: "email",
          status: "queued",
          recipient_account_id: f.owner,
          language: "ar",
        },
        {
          channel: "in_app",
          status: "sent",
          recipient_account_id: f.owner,
          language: "ar",
        },
      ]);
      const outbox = await withSystemTx(
        integrationExecutor("SCHEDULER"),
        { companyId: f.companyId },
        (tx) => rows(tx, "select topic,payload from ops.outbox"),
      );
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.topic).toBe("notification.email");
      const payload =
        typeof outbox[0]?.payload === "string"
          ? (JSON.parse(outbox[0].payload) as unknown)
          : outbox[0]?.payload;
      expect(Object.keys(object(payload))).toEqual(["notificationId"]);
      const subjectHash = object(submitted.body.version).contentHash;
      const approved = await request(
        f,
        f.owner,
        `/contracts/${id}/owner-approval`,
        { body: { expectedVersion: 1, subjectHash } },
      );
      expect(approved.status).toBe(200);
      expect(
        await companyRows(
          f,
          `select id from work.notification where recipient_account_id='${f.tenant}'::uuid`,
        ),
      ).toHaveLength(2);
      const accepted = await request(
        f,
        f.tenant,
        `/contracts/${id}/tenant-acceptance`,
        { body: { expectedVersion: 1, subjectHash } },
      );
      expect(accepted.status).toBe(200);
      expect(
        await companyRows(
          f,
          "select id from work.notification where template_code='contract_concluded'",
        ),
      ).toHaveLength(4);
      expect(
        await companyRows(
          f,
          `select v.id from audit.entity_version v left join audit.event_subject s on s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version left join audit.audit_event e on e.company_id=s.company_id and e.event_id=s.event_id and e.tx_id=v.tx_id group by v.id having count(e.event_id)<>1`,
        ),
      ).toEqual([]);
      const events = await companyRows(
        f,
        "select distinct event_type from audit.audit_event",
      );
      for (const type of [
        "contract.created",
        "contract.awaiting_owner_approval",
        "approval.approved",
        "contract.awaiting_tenant_acceptance",
        "contract.concluded",
        "tawtheeq_record.awaiting_registration",
      ])
        expect(events.some((e) => e.event_type === type)).toBe(true);
      expect(
        (
          await companyRows(
            f,
            `select * from audit.verify_chain('${f.companyId}'::uuid)`,
          )
        )[0]?.ok,
      ).toBe(true);
      await expect(
        withCompanyTx(
          f.executor,
          { companyId: f.companyId, accountId: f.manager },
          (tx) =>
            tx.execute(
              "update audit.audit_event set reason='Synthetic mutation attempt'",
            ),
        ),
      ).rejects.toThrow();
      await expect(
        withCompanyTx(
          f.executor,
          { companyId: f.companyId, accountId: f.manager },
          (tx) => tx.execute("select id from ops.outbox"),
        ),
      ).rejects.toThrow();
      expect(
        await companyRows(
          f,
          "select device,channel from lease.approval_context",
        ),
      ).toHaveLength(3);
    }, 180_000);
  },
);

// Relay evidence requires the development database and never contacts an email provider.
describe.skipIf(!integration)("notification relay database evidence", () => {
  it.each([false, true])(
    "records delivery outcome and transaction coverage with failure=%s",
    async (failure) => {
      const { f, id } = await createDraftFixture();
      const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
        body: { expectedVersion: 1 },
      });
      expect(submitted.status).toBe(200);
      let sends = 0;
      const options = {
        schedulerExecutor: integrationExecutor("SCHEDULER"),
        appExecutor: f.executor,
        companyId: f.companyId,
        now: () => new Date(),
        email: {
          send: () => {
            sends++;
            if (failure)
              return Promise.reject(
                new Error("Synthetic refusal for synthetic@example.invalid"),
              );
            return Promise.resolve({ messageId: "synthetic-delivery-id" });
          },
        },
      };
      const counts = await deliverPendingEmails(options);
      expect(counts).toEqual({
        attempted: 1,
        sent: failure ? 0 : 1,
        failed: failure ? 1 : 0,
        deadLettered: 0,
        skipped: 0,
      });
      expect(
        await companyRows(
          f,
          "select status from work.notification where channel='email'",
        ),
      ).toEqual([{ status: failure ? "failed" : "sent" }]);
      const attempts = await companyRows(
        f,
        "select outcome,provider_message_id,error_detail from work.notification_attempt",
      );
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        outcome: failure ? "failed" : "sent",
        provider_message_id: failure ? null : "synthetic-delivery-id",
      });
      if (failure)
        expect(attempts[0]?.error_detail).toBe(
          "Error: Synthetic refusal for [address]",
        );
      const event = await companyRows(
        f,
        "select e.event_type,e.initiator,e.channel,e.actor_account_id,e.policy_decision,s.subject_type,v.tx_id=e.tx_id as same_tx from audit.audit_event e join audit.event_subject s on s.company_id=e.company_id and s.event_id=e.event_id join audit.entity_version v on v.company_id=s.company_id and v.subject_type=s.subject_type and v.subject_id=s.subject_id and v.subject_version=s.subject_version where e.event_type in ('notification.sent','notification.failed') order by s.subject_type",
      );
      expect(event).toHaveLength(2);
      expect(event.map((r) => r.subject_type)).toEqual([
        "notification",
        "outbox",
      ]);
      for (const row of event)
        expect(row).toMatchObject({
          event_type: failure ? "notification.failed" : "notification.sent",
          initiator: "scheduler",
          channel: "system",
          actor_account_id: null,
          policy_decision: null,
          same_tx: true,
        });
      expect(
        (
          await companyRows(
            f,
            `select * from audit.verify_chain('${f.companyId}'::uuid)`,
          )
        )[0]?.ok,
      ).toBe(true);
      expect(await deliverPendingEmails(options)).toEqual({
        attempted: 0,
        sent: 0,
        failed: 0,
        deadLettered: 0,
        skipped: 0,
      });
      const delivered = await request(f, f.manager, `/contracts/${id}`);
      const deliveries = z
        .array(
          z.object({
            channel: z.string(),
            attempts: z.number(),
            deadLettered: z.boolean(),
            lastErrorCode: z.string().nullable(),
          }),
        )
        .parse(delivered.body.deliveries);
      expect(deliveries.find((item) => item.channel === "email")).toMatchObject(
        {
          attempts: 1,
          deadLettered: false,
          lastErrorCode: failure ? "Error" : null,
        },
      );
      expect(
        deliveries.find((item) => item.channel === "in_app"),
      ).toMatchObject({
        attempts: 0,
        deadLettered: false,
        lastErrorCode: null,
      });
      expect(sends).toBe(1);
    },
    180_000,
  );
});

// This journey creates synthetic rows only and requires an explicit development database run.
describe.skipIf(!integration)("synthetic demo journey", () => {
  it("seeds audited demo parties and concludes with verified identity sessions", async () => {
    vi.stubEnv("STAGE", "local");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);

    try {
      const executor = integrationExecutor();
      const ids = await seedDemo(executor);
      const sessions: Record<string, string> = {};
      for (const account of [ids.manager, ids.owner, ids.tenant]) {
        const token = randomBytes(32).toString("base64url");
        sessions[account] = token;
        await withCompanyTx(
          executor,
          { companyId: ids.companyId, accountId: account },
          async (tx) => {
            await tx.execute(
              "insert into ops.auth_session(account_id,auth_subject,client,session_hash,email,display_name,locale,idle_expires_at,expires_at) select id,auth_subject,'web',:hash,email,display_name,preferred_language,now()+interval '30 minutes',now()+interval '1 day' from core.person_account where id=:account::uuid",
              parameters({
                account,
                hash: createHash("sha256").update(token).digest("hex"),
              }),
            );
          },
        );
      }
      const app = new Hono();
      for (const module of createWorkflowModules({
        dependencies: { executor },
      })) {
        const routes = new Hono();
        module.register(routes);
        app.route(module.basePath, routes);
      }
      const lines: string[] = [];
      const result = await runContractSmoke(ids, {
        sessions,
        request: (url, init) => Promise.resolve(app.request(url, init)),
        print: (line) => {
          lines.push(line);
        },
      });
      expect(result.status).toBe("concluded");
      expect(lines).toHaveLength(8);
      expect(lines[0]).toContain("HTTP 201; contract draft");
      expect(lines[3]).toContain("HTTP 200; contract concluded");
      expect(result.deliveries.length).toBeGreaterThan(0);
      await withCompanyTx(
        executor,
        { companyId: ids.companyId, accountId: ids.manager },
        async (tx) => {
          expect(
            (
              await rows(
                tx,
                "select is_demo,legal_name_en,legal_name_ar from core.company",
              )
            )[0],
          ).toMatchObject({
            is_demo: true,
            legal_name_en: "Demo company (synthetic)",
            legal_name_ar: "شركة تجريبية (synthetic)",
          });
          expect(
            (
              await rows(
                tx,
                "select owner_gate,status from estate.owner_mandate",
              )
            )[0],
          ).toEqual({ owner_gate: null, status: "active" });
          const accounts = await rows(
            tx,
            "select email,display_name from core.person_account",
          );
          expect(accounts).toHaveLength(3);
          for (const account of accounts) {
            expect(account.email).toMatch(
              /^success\+(manager|owner|tenant)-[a-f0-9]+@simulator\.amazonses\.com$/u,
            );
            expect(account.display_name).toMatch(/\(synthetic\)$/u);
          }
          expect(
            (
              await rows(
                tx,
                "select review_status,s3_key from doc.document_version",
              )
            )[0],
          ).toMatchObject({
            review_status: "accepted",
            s3_key: expect.stringMatching(/^test\/contracts\//u) as unknown,
          });
          expect(
            await rows(
              tx,
              "select v.id from audit.entity_version v left join audit.event_subject s on s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version left join audit.audit_event e on e.company_id=s.company_id and e.event_id=s.event_id and e.tx_id=v.tx_id group by v.id having count(e.event_id)<>1",
            ),
          ).toEqual([]);
          expect(
            (
              await rows(
                tx,
                `select * from audit.verify_chain('${ids.companyId}'::uuid)`,
              )
            )[0]?.ok,
          ).toBe(true);
        },
      );
    } finally {
      vi.unstubAllEnvs();
    }
  }, 180_000);
});

// These scenarios require an explicit integration run and synthetic development records.
describe.skipIf(!integration)("stored clause suggestion provenance", () => {
  it("validates suggestions, records exact Arabic provenance and preserves it on reload", async () => {
    const registry = loadModelRegistry();
    const textAr = "يلتزم المستأجر بإبقاء الشرفة خالية.";
    const generate = vi.fn(() =>
      Promise.resolve({
        text: JSON.stringify({ textAr, warnings: [] }),
        usage: ZERO_USAGE,
        modelEcho: null,
        finish: "completed" as const,
      }),
    );
    const modelGateway = createModelGateway({
      registry,
      structuredAdapters: { openai_responses: { generate } },
      transcriptionAdapters: {},
      now: () => new Date(),
    });
    const { f, id, created } = await createDraftFixture({
      modelGateway,
      secondManager: true,
    });
    expect(object(created.body.viewer).allowedActions).toContain(
      "suggest_clause",
    );
    for (const actor of [f.owner, f.tenant]) {
      const viewed = await request(f, actor, `/contracts/${id}`);
      expect(object(viewed.body.viewer).allowedActions).not.toContain(
        "suggest_clause",
      );
    }
    const key = randomUUID();
    const suggested = await request(
      f,
      f.manager,
      `/contracts/${id}/clause-suggestions`,
      { body: { textEn: "Keep the balcony clear." }, key },
    );
    expect(suggested.status, JSON.stringify(suggested.body)).toBe(200);
    const suggestionId = z.uuid().parse(suggested.body.suggestionId);
    expect(
      (
        await request(f, f.manager, `/contracts/${id}/clause-suggestions`, {
          body: { textEn: "Keep the balcony clear." },
          key,
        })
      ).body,
    ).toEqual(suggested.body);
    expect(generate).toHaveBeenCalledTimes(1);
    const terms = termsSchema.strip().parse(draft(f));
    terms.specialClauses = [
      {
        textEn: "Keep the balcony clear.",
        textAr,
        modelTranslated: false,
        suggestionId,
      },
    ];
    const registryEntry = `mc5_drafting/${registry.classes.mc5_drafting.primary}`;
    for (const [index, confirmation] of [
      "ai_confirmed",
      "ai_edited",
    ].entries()) {
      if (index === 1)
        terms.specialClauses = [
          {
            textEn: "Keep the balcony clear.",
            textAr: textAr + " ",
            modelTranslated: false,
            suggestionId,
          },
        ];
      const saved = await request(f, f.manager, `/contracts/${id}/draft`, {
        method: "PUT",
        body: { expectedVersion: index + 1, terms },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const events = await companyRows(
        f,
        "select field_provenance,registry_entry,prompt_version from audit.audit_event where event_type='contract.updated' order by seq desc limit 1",
      );
      expect(events[0]).toMatchObject({
        field_provenance: JSON.stringify({ clause_1: confirmation }),
        registry_entry: registryEntry,
        prompt_version: "clause-translation.v1",
      });
      const reloaded = await request(f, f.manager, `/contracts/${id}`);
      expect(object(reloaded.body.version).specialClauses).toEqual([
        {
          position: 1,
          textEn: "Keep the balcony clear.",
          textAr: terms.specialClauses[0]?.textAr,
          modelTranslated: true,
          suggestion: {
            registryEntry,
            promptVersion: "clause-translation.v1",
            confirmation,
          },
        },
      ]);
    }
    const requesterRefusal = await request(
      f,
      f.accountant,
      `/contracts/${id}/draft`,
      { method: "PUT", body: { expectedVersion: 3, terms } },
    );
    expect(requesterRefusal.status).toBe(422);
    expect(requesterRefusal.body).toMatchObject({
      code: "INVALID_INPUT",
      field: "specialClauses.0.suggestionId",
    });
    const other = await request(f, f.manager, "/contracts", { body: draft(f) });
    const otherId = z.uuid().parse(object(other.body.contract).id);
    const before = await companyRows(
      f,
      "select count(*) as count from lease.contract_version",
    );
    const rejected = await request(
      f,
      f.manager,
      `/contracts/${otherId}/draft`,
      { method: "PUT", body: { expectedVersion: 1, terms } },
    );
    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({
      code: "INVALID_INPUT",
      field: "specialClauses.0.suggestionId",
    });
    expect(
      await companyRows(
        f,
        "select count(*) as count from lease.contract_version",
      ),
    ).toEqual(before);
    const refusedCreate = await request(f, f.manager, "/contracts", {
      body: { ...draft(f), specialClauses: terms.specialClauses },
    });
    expect(refusedCreate.status).toBe(422);
    const manual = await request(f, f.manager, `/contracts/${otherId}/draft`, {
      method: "PUT",
      body: {
        expectedVersion: 1,
        terms: {
          ...terms,
          specialClauses: [
            { textEn: "Typed", textAr: "نص مكتوب", modelTranslated: true },
          ],
        },
      },
    });
    expect(manual.status).toBe(200);
    expect(object(manual.body.version).specialClauses).toMatchObject([
      { modelTranslated: false, suggestion: null },
    ]);
    const submitted = await request(f, f.manager, `/contracts/${id}/submit`, {
      body: { expectedVersion: 3 },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(object(submitted.body.viewer).allowedActions).not.toContain(
      "suggest_clause",
    );
    expect(
      await companyRows(
        f,
        "select count(*) as count from lease.clause_suggestion",
      ),
    ).toEqual([{ count: "1" }]);
    expect(
      await companyRows(
        f,
        "select initiator,actor_account_id,registry_entry from audit.audit_event where event_type='clause_suggestion.created'",
      ),
    ).toEqual([
      {
        initiator: "person",
        actor_account_id: f.manager,
        registry_entry: registryEntry,
      },
    ]);
    expect(
      await companyRows(
        f,
        "select v.subject_type from audit.entity_version v left join audit.event_subject s on s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version group by v.subject_type,v.subject_id,v.subject_version having count(s.event_id)<>1",
      ),
    ).toEqual([]);
    expect(
      (
        await companyRows(
          f,
          `select * from audit.verify_chain('${f.companyId}'::uuid)`,
        )
      )[0]?.ok,
    ).toBe(true);
  }, 600_000);
});
