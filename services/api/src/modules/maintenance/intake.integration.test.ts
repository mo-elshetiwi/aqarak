import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ticketSummarySchema, ticketViewSchema } from "./contract";
import {
  createFixtures,
  uploadResponseSchema,
  uploadFixtureMedia,
  integrationReady,
  integrationReason,
  type Fixtures,
} from "./integration-fixtures";
import { audit, parameter, transaction, uuid } from "./access";

const uploadResponse = uploadResponseSchema;
type Slot = z.infer<typeof uploadResponse>;
const bytes = Buffer.from("synthetic maintenance photo bytes");
const digest = createHash("sha256").update(bytes).digest("hex");
function body(unitId: string): Record<string, unknown> {
  return {
    unitId,
    kind: "photo",
    contentType: "image/jpeg",
    byteSize: bytes.length,
    sha256: digest,
  };
}
function fingerprint(value: unknown): string {
  const stable = JSON.stringify(
    value,
    (_key: string, nested: unknown): unknown => {
      if (nested && typeof nested === "object" && !Array.isArray(nested))
        return Object.fromEntries(
          Object.entries(nested).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        );
      return nested;
    },
  );
  return createHash("sha256").update(stable).digest("hex");
}
if (!integrationReady) process.stdout.write(`${integrationReason}\n`);

// The real-service suite only runs with the dedicated development database and bucket configured.
describe.runIf(integrationReady)(
  integrationReady
    ? "maintenance development database and documents bucket"
    : integrationReason,
  () => {
    let f: Fixtures;
    let dispose = (): void => undefined;
    let uploaded: Slot;
    beforeAll(async () => {
      f = await createFixtures();
      dispose = () => {
        f.s3.destroy();
      };
    }, 180000);
    afterAll(() => {
      dispose();
    });
    async function request(
      account: string,
      method: string,
      path: string,
      ...[payload, key = randomUUID(), company]: [
        payload?: unknown,
        key?: string,
        company?: string,
      ]
    ): Promise<Response> {
      return f.app.request(`/v1/companies/${company ?? f.a}${path}`, {
        method,
        headers: {
          authorization: `synthetic-${account}`,
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    }
    async function slot(account = f.tenant1, unit = f.u1): Promise<Slot> {
      const response = await request(
        account,
        "POST",
        "/media/uploads",
        body(unit),
      );
      expect(response.status).toBe(201);
      return uploadResponse.parse(await response.json());
    }
    async function count(
      sql: string,
      parameters: Parameters<Fixtures["query"]>[1] = [],
    ): Promise<number> {
      return Number((await f.query(sql, parameters)).rows[0]?.count);
    }
    async function refusal(
      account: string,
      method: string,
      path: string,
      ...[payload, status, code]: [
        payload: unknown,
        status: number,
        code: string,
      ]
    ): Promise<void> {
      const before = await count(
        "select count(*) from audit.audit_event where event_type = 'policy.denied'",
      );
      const mediaBefore = await count("select count(*) from maint.media");
      const response = await request(account, method, path, payload);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(await response.json()).toMatchObject({ code });
      expect(
        await count(
          "select count(*) from audit.audit_event where event_type = 'policy.denied'",
        ),
      ).toBe(before + 1);
      expect(await count("select count(*) from maint.media")).toBe(mediaBefore);
      const event = (
        await f.query(
          "select actor_account_id, initiator, channel, visibility, policy_decision from audit.audit_event where event_type = 'policy.denied' order by seq desc limit 1",
        )
      ).rows[0];
      expect(event).toMatchObject({
        actor_account_id: account,
        initiator: "person",
        visibility: "staff",
      });
      const policy: unknown =
        typeof event?.policy_decision === "string"
          ? JSON.parse(event.policy_decision)
          : event?.policy_decision;
      expect(policy).toEqual({
        policy_version: "maintenance-access-1",
        result: "deny",
        reasons: [code],
      });
    }
    it("AC-6 uploads tenant photo bytes, completes version two and covers exactly two events", async () => {
      uploaded = await slot();
      const put = await fetch(uploaded.upload.url, {
        method: "PUT",
        headers: uploaded.upload.headers,
        body: bytes,
      });
      expect(put.status).toBe(200);
      const response = await request(
        f.tenant1,
        "POST",
        `/media/${uploaded.media.id}/complete`,
        { expectedVersion: 1 },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        media: { id: uploaded.media.id, status: "uploaded", version: 2 },
      });
      const media = (
        await f.query("select s3_version_id from maint.media where id = :id", [
          uuid("id", uploaded.media.id),
        ])
      ).rows[0];
      expect(typeof media?.s3_version_id).toBe("string");
      expect(media?.s3_version_id).not.toBe("null");
      const events = await f.query(
        `select e.event_type, e.version_after, count(s.subject_id)::integer as coverage from audit.audit_event e
      join audit.event_subject s on s.company_id = e.company_id and s.event_id = e.event_id
      join audit.entity_version v on v.company_id = s.company_id and v.subject_type = s.subject_type and v.subject_id = s.subject_id and v.subject_version = s.subject_version and v.tx_id = e.tx_id
      where e.subject_id = :id group by e.event_type, e.version_after order by e.version_after`,
        [uuid("id", uploaded.media.id)],
      );
      expect(
        events.rows.map((row) => [
          row.event_type,
          Number(row.version_after),
          Number(row.coverage),
        ]),
      ).toEqual([
        ["media.upload_requested", 1, 1],
        ["media.uploaded", 2, 1],
      ]);
      const download = await request(
        f.tenant1,
        "GET",
        `/media/${uploaded.media.id}/download`,
      );
      expect(download.status).toBe(200);
      const downloadBody = z
        .object({ url: z.string(), expiresAt: z.string() })
        .parse(await download.json());
      expect(
        new URL(downloadBody.url).searchParams.get("versionId") ===
          media?.s3_version_id,
      ).toBe(true);
      expect(
        Buffer.from(await (await fetch(downloadBody.url)).arrayBuffer()).equals(
          bytes,
        ),
      ).toBe(true);
    }, 180000);
    it("AC-7 allows a manager voice-note slot on another tenant unit", async () => {
      const response = await request(f.manager, "POST", "/media/uploads", {
        ...body(f.u2),
        kind: "voice_note",
        contentType: "audio/mp4",
        durationMs: 300000,
      });
      expect(response.status).toBe(201);
      const result = uploadResponse.parse(await response.json());
      expect(result.media.kind).toBe("voice_note");
      expect(
        (
          await f.query(
            "select channel from audit.audit_event where subject_id = :id",
            [uuid("id", result.media.id)],
          )
        ).rows[0]?.channel,
      ).toBe("voice");
    }, 180000);
    it("AC-8 denies foreign-company upload and ticket reads in company A's chain", async () => {
      await refusal(
        f.tenantB,
        "POST",
        "/media/uploads",
        body(f.u1),
        404,
        "NOT_FOUND",
      );
      await refusal(
        f.tenantB,
        "GET",
        "/maintenance/tickets",
        undefined,
        404,
        "NOT_FOUND",
      );
    }, 180000);
    it("AC-9 denies another tenant's unit, completion and download", async () => {
      await refusal(
        f.tenant2,
        "POST",
        "/media/uploads",
        body(f.u1),
        404,
        "NOT_FOUND",
      );
      await refusal(
        f.tenant2,
        "POST",
        `/media/${uploaded.media.id}/complete`,
        { expectedVersion: 2 },
        404,
        "NOT_FOUND",
      );
      await refusal(
        f.tenant2,
        "GET",
        `/media/${uploaded.media.id}/download`,
        undefined,
        404,
        "NOT_FOUND",
      );
    }, 180000);
    it("AC-10 refuses an accountant upload with one policy denial", async () => {
      await refusal(
        f.accountant,
        "POST",
        "/media/uploads",
        body(f.u1),
        403,
        "NOT_AUTHORISED",
      );
    }, 180000);
    it("AC-11 validates voice size without any database writes", async () => {
      const before = await count("select count(*) from audit.audit_event");
      const response = await request(f.tenant1, "POST", "/media/uploads", {
        ...body(f.u1),
        kind: "voice_note",
        contentType: "audio/mp4",
        byteSize: 26 * 1024 * 1024,
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: "LIMIT_EXCEEDED",
        field: "byteSize",
      });
      expect(await count("select count(*) from audit.audit_event")).toBe(
        before,
      );
    }, 180000);
    it("AC-12 replays an identical request and refuses key reuse without writes", async () => {
      const key = randomUUID();
      const first = await request(
        f.tenant1,
        "POST",
        "/media/uploads",
        body(f.u1),
        key,
      );
      expect(first.status).toBe(201);
      const firstBody = uploadResponse.parse(await first.json());
      const before = await count("select count(*) from audit.audit_event");
      const second = await request(
        f.tenant1,
        "POST",
        "/media/uploads",
        body(f.u1),
        key,
      );
      expect(second.status).toBe(201);
      expect(second.headers.get("Idempotent-Replayed")).toBe("true");
      expect(fingerprint(await second.json())).toBe(fingerprint(firstBody));
      const reused = await request(
        f.tenant1,
        "POST",
        "/media/uploads",
        { ...body(f.u1), byteSize: bytes.length + 1 },
        key,
      );
      expect(reused.status).toBe(422);
      expect(await reused.json()).toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSED",
      });
      expect(await count("select count(*) from audit.audit_event")).toBe(
        before,
      );
      expect(
        await count("select count(*) from maint.media where id = :id", [
          uuid("id", firstBody.media.id),
        ]),
      ).toBe(1);
    }, 180000);
    it("AC-13 rejects a stale completion without changing rows or events", async () => {
      const pending = await slot();
      const before = await count("select count(*) from audit.audit_event");
      const response = await request(
        f.tenant1,
        "POST",
        `/media/${pending.media.id}/complete`,
        { expectedVersion: 7 },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "STALE_VERSION",
        currentVersion: 1,
      });
      expect(await count("select count(*) from audit.audit_event")).toBe(
        before,
      );
      expect(
        Number(
          (
            await f.query("select version from maint.media where id = :id", [
              uuid("id", pending.media.id),
            ])
          ).rows[0]?.version,
        ),
      ).toBe(1);
    }, 180000);
    it("AC-14 S3 rejects wrong bytes and completion without an object writes nothing", async () => {
      const pending = await slot();
      const wrongBytes = Buffer.alloc(bytes.length, 88);
      const put = await fetch(pending.upload.url, {
        method: "PUT",
        headers: pending.upload.headers,
        body: wrongBytes,
      });
      expect(put.status).toBeGreaterThanOrEqual(400);
      expect(put.status).toBeLessThan(500);
      const before = await count("select count(*) from audit.audit_event");
      const response = await request(
        f.tenant1,
        "POST",
        `/media/${pending.media.id}/complete`,
        { expectedVersion: 1 },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "UPLOAD_NOT_FOUND" });
      expect(await count("select count(*) from audit.audit_event")).toBe(
        before,
      );
    }, 180000);
    it("AC-15 scopes unit lists, returns empty tickets and audits a missing ticket", async () => {
      const tenant = await request(f.tenant1, "GET", "/maintenance/units");
      expect(tenant.status).toBe(200);
      const tenantUnits = z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(await tenant.json());
      expect(tenantUnits.items.map((unit) => unit.id)).toEqual([f.u1]);
      const manager = await request(f.manager, "GET", "/maintenance/units");
      const managerUnits = z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(await manager.json());
      expect(managerUnits.items.map((unit) => unit.id).sort()).toEqual(
        [f.u1, f.u2].sort(),
      );
      const tickets = await request(f.tenant1, "GET", "/maintenance/tickets");
      expect(tickets.status).toBe(200);
      expect(await tickets.json()).toEqual({ items: [], nextCursor: null });
      await refusal(
        f.tenant1,
        "GET",
        `/maintenance/tickets/${randomUUID()}`,
        undefined,
        404,
        "NOT_FOUND",
      );
    }, 180000);
    it("AC-17 serialises parallel duplicate slots to one row and one event", async () => {
      const key = randomUUID();
      const beforeMedia = await count("select count(*) from maint.media");
      const beforeEvents = await count(
        "select count(*) from audit.audit_event",
      );
      const responses = await Promise.all([
        request(f.tenant1, "POST", "/media/uploads", body(f.u1), key),
        request(f.tenant1, "POST", "/media/uploads", body(f.u1), key),
      ]);
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(
        responses.filter(
          (response) => response.headers.get("Idempotent-Replayed") === "true",
        ),
      ).toHaveLength(1);
      const values: unknown[] = await Promise.all(
        responses.map((response) => response.json()),
      );
      expect(fingerprint(values[0])).toBe(fingerprint(values[1]));
      expect(await count("select count(*) from maint.media")).toBe(
        beforeMedia + 1,
      );
      expect(await count("select count(*) from audit.audit_event")).toBe(
        beforeEvents + 1,
      );
    }, 180000);
    it.each([
      ["GET", "/maintenance/units"],
      ["GET", "/maintenance/tickets"],
      ["GET", "/maintenance/tickets/record"],
      ["GET", "/media/record/download"],
      ["POST", "/media/record/complete"],
    ])(
      "enforces both company and role access on %s %s",
      async (method, path) => {
        const recordPath = path.replace("record", uploaded.media.id);
        const payload = method === "POST" ? { expectedVersion: 2 } : undefined;
        await refusal(f.tenantB, method, recordPath, payload, 404, "NOT_FOUND");
        await refusal(
          f.accountant,
          method,
          recordPath,
          payload,
          403,
          "NOT_AUTHORISED",
        );
      },
      180000,
    );
    it("reads populated ticket scope with stable equal-timestamp pagination", async () => {
      const ownUnit = randomUUID();
      const ownReport = randomUUID();
      const otherReport = randomUUID();
      await transaction(
        f.db,
        {
          companyId: f.a,
          subject: f.manager,
          channel: "mobile_form",
        },
        async (tx) => {
          for (const [id, unit, reporter] of [
            [ownUnit, f.u1, f.manager],
            [ownReport, f.u2, f.tenant1],
            [otherReport, f.u2, f.tenant2],
          ] as const) {
            await tx.execute(
              `insert into maint.ticket(id, company_id, unit_id, reported_by_account_id, category, priority, status, payer, description_en, created_at)
            values (:id, :company, :unit, :reporter, 'plumbing', 'routine', 'reported', 'owner', 'Synthetic leaking tap', '2026-09-28 00:00:00.123456+00')`,
              [
                uuid("id", id),
                uuid("company", f.a),
                uuid("unit", unit),
                uuid("reporter", reporter),
              ],
            );
            await audit(tx, {
              event: "ticket.created",
              subjectType: "ticket",
              subjectId: id,
              versionAfter: 1,
            });
          }
        },
      );
      const pageSchema = z.object({
        items: z.array(ticketSummarySchema),
        nextCursor: z.string().nullable(),
      });
      const first = pageSchema.parse(
        await (
          await request(
            f.tenant1,
            "GET",
            "/maintenance/tickets?limit=1&status=reported",
          )
        ).json(),
      );
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = pageSchema.parse(
        await (
          await request(
            f.tenant1,
            "GET",
            `/maintenance/tickets?limit=1&status=reported&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
          )
        ).json(),
      );
      expect(second.nextCursor).toBeNull();
      expect(
        [...first.items, ...second.items].map((item) => item.id).sort(),
      ).toEqual([ownUnit, ownReport].sort());
      const detail = await request(
        f.tenant1,
        "GET",
        `/maintenance/tickets/${ownUnit}`,
      );
      expect(detail.status).toBe(200);
      const view = z
        .object({ ticket: ticketViewSchema })
        .parse(await detail.json());
      expect(view.ticket).toMatchObject({
        id: ownUnit,
        version: 1,
        description: "Synthetic leaking tap",
        transcript: null,
        safetyFlags: [],
        channel: null,
        intakeId: null,
        media: [],
        reportedByMe: false,
      });
      const manager = pageSchema.parse(
        await (await request(f.manager, "GET", "/maintenance/tickets")).json(),
      );
      expect(manager.items).toHaveLength(3);
      await refusal(
        f.tenant1,
        "GET",
        `/maintenance/tickets/${otherReport}`,
        undefined,
        404,
        "NOT_FOUND",
      );
      const before = await count("select count(*) from audit.audit_event");
      for (const query of [
        "limit=0",
        "limit=51",
        "status=invalid",
        "cursor=invalid",
      ]) {
        expect(
          (await request(f.tenant1, "GET", `/maintenance/tickets?${query}`))
            .status,
        ).toBe(400);
      }
      expect(await count("select count(*) from audit.audit_event")).toBe(
        before,
      );
      expect(
        await count(
          "select count(*) from maint.ticket where description_en = :description",
          [parameter("description", "Synthetic leaking tap")],
        ),
      ).toBe(3);
    }, 180000);
    it("AC-3 limits ticket and media reads to the current tenancy start", async () => {
      const beforeTerm = randomUUID();
      const atTerm = randomUUID();
      const afterTerm = randomUUID();
      const ownBeforeTerm = randomUUID();
      const oldMedia = await uploadFixtureMedia(f, {
        kind: "photo",
        bytes: Buffer.from("synthetic previous tenancy photo"),
      });
      const currentMedia = await uploadFixtureMedia(f, {
        kind: "photo",
        account: f.manager,
        bytes: Buffer.from("synthetic current tenancy photo"),
      });
      await transaction(
        f.db,
        {
          companyId: f.a,
          subject: f.manager,
          channel: "mobile_form",
        },
        async (tx) => {
          for (const [id, createdAt, reporter] of [
            [beforeTerm, "2025-12-31 23:59:59.999999+00", f.manager],
            [atTerm, "2026-01-01 00:00:00+00", f.manager],
            [afterTerm, "2026-01-01 00:00:00.000001+00", f.manager],
            [ownBeforeTerm, "2025-12-31 23:59:59.999999+00", f.tenant1],
          ] as const) {
            await tx.execute(
              `insert into maint.ticket(id, company_id, created_by, unit_id, reported_by_account_id, category, priority, status, payer, description_en, created_at)
            values (:id, :company, :creator, :unit, :reporter, 'plumbing', 'routine', 'reported', 'owner', 'Synthetic tenancy boundary ticket', cast(:created as timestamptz))`,
              [
                uuid("id", id),
                uuid("company", f.a),
                uuid("creator", f.manager),
                uuid("unit", f.u1),
                uuid("reporter", reporter),
                parameter("created", createdAt),
              ],
            );
            await audit(tx, {
              event: "ticket.created",
              subjectType: "ticket",
              subjectId: id,
              versionAfter: 1,
            });
          }
          for (const [id, ticketId] of [
            [oldMedia, beforeTerm],
            [currentMedia, afterTerm],
          ] as const) {
            await tx.execute(
              "update maint.media set ticket_id = :ticket where company_id = :company and id = :id",
              [uuid("ticket", ticketId), uuid("company", f.a), uuid("id", id)],
            );
            await audit(tx, {
              event: "media.linked",
              subjectType: "media",
              subjectId: id,
              versionBefore: 2,
              versionAfter: 3,
            });
          }
        },
      );
      const listSchema = z.object({ items: z.array(ticketViewSchema) });
      const tenantList = await request(
        f.tenant1,
        "GET",
        "/maintenance/tickets",
      );
      expect(tenantList.status).toBe(200);
      const tenantIds = listSchema
        .parse(await tenantList.json())
        .items.map((item) => item.id);
      expect(tenantIds).not.toContain(beforeTerm);
      expect(tenantIds).toEqual(
        expect.arrayContaining([atTerm, afterTerm, ownBeforeTerm]),
      );
      const managerList = await request(
        f.manager,
        "GET",
        "/maintenance/tickets",
      );
      expect(managerList.status).toBe(200);
      expect(
        listSchema.parse(await managerList.json()).items.map((item) => item.id),
      ).toEqual(
        expect.arrayContaining([beforeTerm, atTerm, afterTerm, ownBeforeTerm]),
      );
      for (const id of [atTerm, afterTerm, ownBeforeTerm])
        expect(
          (await request(f.tenant1, "GET", `/maintenance/tickets/${id}`))
            .status,
        ).toBe(200);
      expect(
        (await request(f.tenant1, "GET", `/media/${currentMedia}/download`))
          .status,
      ).toBe(200);
      for (const path of [
        `/maintenance/tickets/${beforeTerm}`,
        `/media/${oldMedia}/download`,
      ])
        expect((await request(f.manager, "GET", path)).status).toBe(200);
      for (const [hiddenPath, missingPath] of [
        [
          `/maintenance/tickets/${beforeTerm}`,
          `/maintenance/tickets/${randomUUID()}`,
        ],
        [`/media/${oldMedia}/download`, `/media/${randomUUID()}/download`],
      ] as const) {
        const bodies: unknown[] = [];
        for (const path of [hiddenPath, missingPath]) {
          const before = await count(
            "select count(*) from audit.audit_event where event_type = 'policy.denied'",
          );
          const response = await request(f.tenant1, "GET", path);
          expect(response.status).toBe(404);
          const body: unknown = await response.json();
          expect(body).toMatchObject({ code: "NOT_FOUND" });
          bodies.push(body);
          expect(
            await count(
              "select count(*) from audit.audit_event where event_type = 'policy.denied'",
            ),
          ).toBe(before + 1);
        }
        expect(bodies[0]).toEqual(bodies[1]);
      }
    }, 180000);
    it("AC-16 verifies both company chains after all commands and refusals", async () => {
      for (const company of [f.a, f.b]) {
        const result = await f.query(
          "select * from audit.verify_chain(:company)",
          [uuid("company", company)],
          company,
        );
        expect(result.rows[0]?.ok).toBe(true);
      }
    }, 180000);
  },
);
