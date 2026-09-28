import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createFixtures,
  fixtureRequest,
  integrationReady,
  integrationReason,
  uploadFixtureMedia,
  type Fixtures,
} from "./integration-fixtures";
import { fakeIntakeModels } from "./model-fixtures";
import {
  intakeViewSchema,
  ticketViewSchema,
  type IntakeView,
} from "./contract";
import { audit, parameter, transaction, uuid } from "./access";

if (!integrationReady) process.stdout.write(`${integrationReason}\n`);
const parseJson = (value: unknown): unknown =>
  typeof value === "string" ? (JSON.parse(value) as unknown) : value;
describe.runIf(integrationReady)(
  integrationReady ? "maintenance intake acceptance" : integrationReason,
  () => {
    let f: Fixtures;
    let clockOffset = 0;
    let dispose = (): void => undefined;
    const models = fakeIntakeModels();
    let ready: IntakeView;
    let voice: string;
    let photo: string;
    let confirmedTicket: string;
    beforeAll(async () => {
      f = await createFixtures({ models, now: () => Date.now() + clockOffset });
      dispose = () => {
        f.s3.destroy();
      };
    }, 180000);
    afterAll(() => {
      dispose();
    });
    const request = (
      account: string,
      method: string,
      path: string,
      ...[body, key = randomUUID()]: [body?: unknown, key?: string]
    ) => fixtureRequest(f, account, method, path, body, key);
    const report = (changes: Record<string, unknown> = {}) => ({
      unitId: f.u1,
      language: "ar",
      voiceMediaId: null,
      photoMediaIds: [],
      typedText: "تسرب مياه",
      ...changes,
    });
    const edits = (
      intake: IntakeView,
      changes: Record<string, unknown> = {},
    ) => ({
      expectedVersion: intake.version,
      transcript: intake.transcript,
      category: intake.category,
      priority: intake.priority,
      safetyFlags: intake.safetyFlags,
      description: intake.description,
      ...changes,
    });
    async function count(
      sql: string,
      params: Parameters<Fixtures["query"]>[1] = [],
    ): Promise<number> {
      return Number((await f.query(sql, params)).rows[0]?.count);
    }
    async function create(
      changes: Record<string, unknown> = {},
    ): Promise<IntakeView> {
      const response = await request(
        f.tenant1,
        "POST",
        "/maintenance/intakes",
        report(changes),
      );
      const value: unknown = await response.json();
      expect(response.status, JSON.stringify(value)).toBe(201);
      return z.object({ intake: intakeViewSchema }).parse(value).intake;
    }
    async function denial(
      account: string,
      path: string,
      body: unknown,
      status = 404,
    ): Promise<void> {
      const before = await count(
        "select count(*) from audit.audit_event where event_type = 'policy.denied'",
      );
      const drafts = await count("select count(*) from ai.drafted_action");
      const tickets = await count("select count(*) from maint.ticket");
      const response = await request(account, "POST", path, body);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        code: status === 404 ? "NOT_FOUND" : "NOT_AUTHORISED",
      });
      expect(
        await count(
          "select count(*) from audit.audit_event where event_type = 'policy.denied'",
        ),
      ).toBe(before + 1);
      expect(await count("select count(*) from ai.drafted_action")).toBe(
        drafts,
      );
      expect(await count("select count(*) from maint.ticket")).toBe(tickets);
    }
    async function coverage(
      subjectId: string,
      event: string,
    ): Promise<string[]> {
      const result = await f.query(
        `select s.subject_type, s.subject_version from audit.audit_event e join audit.event_subject s on s.company_id = e.company_id and s.event_id = e.event_id join audit.entity_version v on v.company_id = s.company_id and v.subject_type = s.subject_type and v.subject_id = s.subject_id and v.subject_version = s.subject_version and v.tx_id = e.tx_id where e.subject_id = :id and e.event_type = :event`,
        [uuid("id", subjectId), parameter("event", event)],
      );
      return result.rows
        .map(
          (row) => `${String(row.subject_type)}:${String(row.subject_version)}`,
        )
        .sort();
    }
    it("AC-6 drafts Arabic voice and photo evidence without a ticket, then confirms edited text with full audit coverage", async () => {
      voice = await uploadFixtureMedia(f, {
        kind: "voice_note",
        bytes: Buffer.from("synthetic voice note bytes"),
      });
      photo = await uploadFixtureMedia(f, {
        kind: "photo",
        bytes: Buffer.from("synthetic photo bytes"),
      });
      const key = randomUUID();
      const body = report({
        voiceMediaId: voice,
        photoMediaIds: [photo],
        typedText: null,
      });
      const gateway = vi.spyOn(models.gateway, "transcribe");
      const response = await request(
        f.tenant1,
        "POST",
        "/maintenance/intakes",
        body,
        key,
      );
      const raw: unknown = await response.json();
      expect(response.status, JSON.stringify(raw)).toBe(201);
      ready = z.object({ intake: intakeViewSchema }).parse(raw).intake;
      expect(ready).toMatchObject({
        status: "ready",
        transcript: "يوجد تسرب مياه في المطبخ",
        category: "plumbing",
        safetyFlags: ["water_into_electrics"],
        transcription: { mode: "model" },
        triage: { mode: "model" },
        ticketId: null,
      });
      expect(
        await count("select count(*) from maint.ticket where unit_id = :id", [
          uuid("id", f.u1),
        ]),
      ).toBe(0);
      const draftedEvent = (
        await f.query(
          "select initiator, actor_account_id, model_call_ids, prompt_version, registry_entry from audit.audit_event where subject_id = :id and event_type = 'drafted_action.drafted'",
          [uuid("id", ready.id)],
        )
      ).rows[0];
      expect(draftedEvent).toMatchObject({
        initiator: "pipeline",
        actor_account_id: f.tenant1,
        prompt_version: "ticket-triage@1",
        registry_entry: "mc4_photo_triage:primary",
      });
      const receipts = (
        await f.query(
          "select id, class_id from maint.intake_model_call where drafted_action_id = :id",
          [uuid("id", ready.id)],
        )
      ).rows;
      expect(parseJson(draftedEvent?.model_call_ids)).toEqual([
        receipts.find((row) => row.class_id === "mc3_speech_to_text")?.id,
        receipts.find((row) => row.class_id === "mc4_photo_triage")?.id,
      ]);
      expect(
        await count(
          "select count(*) from audit.audit_event where subject_id = :id and event_type = 'drafted_action.drafted'",
          [uuid("id", ready.id)],
        ),
      ).toBe(1);
      expect(await coverage(ready.id, "drafted_action.drafted")).toEqual([
        "drafted_action:1",
        "intake_model_call:1",
        "intake_model_call:1",
        "media:3",
        "media:3",
      ]);
      expect(
        await count(
          "select count(*) from maint.intake_model_call where drafted_action_id = :id",
          [uuid("id", ready.id)],
        ),
      ).toBe(2);
      const replay = await request(
        f.tenant1,
        "POST",
        "/maintenance/intakes",
        body,
        key,
      );
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
      expect(gateway).toHaveBeenCalledOnce();
      expect(gateway.mock.calls[0]?.[0].audio).toMatchObject({
        mediaType: "audio/mp4",
        fileName: "voice-note.m4a",
        durationMs: 1000,
      });
      expect(Buffer.from(gateway.mock.calls[0]?.[0].audio.bytes ?? [])).toEqual(
        Buffer.from("synthetic voice note bytes"),
      );
      gateway.mockRestore();
      const detail = await request(
        f.tenant1,
        "GET",
        `/maintenance/intakes/${ready.id}`,
      );
      expect(detail.status).toBe(200);
      expect(await detail.json()).toEqual({ intake: ready });
      const confirmed = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${ready.id}/confirm`,
        edits(ready, { transcript: "تسرب مياه بجوار الكهرباء في المطبخ" }),
      );
      const confirmedRaw: unknown = await confirmed.json();
      expect(confirmed.status, JSON.stringify(confirmedRaw)).toBe(201);
      const result = z
        .object({ ticket: ticketViewSchema, intake: intakeViewSchema })
        .parse(confirmedRaw);
      confirmedTicket = result.ticket.id;
      expect(result.ticket).toMatchObject({
        status: "reported",
        priority: "emergency",
        safetyCritical: true,
        intakeId: ready.id,
        channel: "voice",
        payer: "owner",
      });
      expect(result.ticket.media).toHaveLength(2);
      expect(result.intake.status).toBe("committed");
      expect(
        (
          await f.query(
            "select transcript_edited from maint.ticket_intake where ticket_id = :id",
            [uuid("id", result.ticket.id)],
          )
        ).rows[0]?.transcript_edited,
      ).toBe(true);
      expect(await coverage(result.ticket.id, "ticket.reported")).toEqual([
        "drafted_action:2",
        "media:4",
        "media:4",
        "outbox:1",
        "ticket:1",
        "ticket_intake:1",
      ]);
      const event = (
        await f.query(
          "select field_provenance from audit.audit_event where subject_id = :id and event_type = 'ticket.reported'",
          [uuid("id", result.ticket.id)],
        )
      ).rows[0];
      expect(parseJson(event?.field_provenance)).toMatchObject({
        "/transcript": "ai_edited",
        "/category": "ai_confirmed",
      });
      const outbox = (
        await f.query(
          "select snapshot from audit.entity_version where subject_type = 'outbox' and snapshot->'payload'->>'ticketId' = :id",
          [parameter("id", result.ticket.id)],
        )
      ).rows[0];
      expect(parseJson(outbox?.snapshot)).toMatchObject({
        topic: "maintenance.ticket_reported",
        payload: { ticketId: result.ticket.id },
        dedupe_key: `ticket_reported:${result.ticket.id}`,
      });
      for (const [account, expected] of [
        [f.tenant1, true],
        [f.manager, true],
        [f.tenant2, false],
      ] as const) {
        const list = await request(account, "GET", "/maintenance/tickets");
        const items = z
          .object({ items: z.array(ticketViewSchema) })
          .parse(await list.json()).items;
        expect(items.some((item) => item.id === confirmedTicket)).toBe(
          expected,
        );
      }
    }, 180000);
    it("AC-7 provider failures degrade to typing and untriaged text with human provenance", async () => {
      const failed = fakeIntakeModels({
        speech: ["fail", "fail"],
        triage: ["fail", "fail"],
      });
      const original = models.gateway;
      models.gateway = failed.gateway;
      try {
        const voiceMediaId = await uploadFixtureMedia(f, {
          kind: "voice_note",
          bytes: Buffer.from("synthetic failed voice"),
        });
        const intake = await create({
          voiceMediaId,
          typedText: "Typed report",
        });
        expect(intake).toMatchObject({
          transcript: null,
          category: "other",
          priority: "routine",
          safetyFlags: [],
          payer: "owner",
          description: "Typed report",
          transcription: { mode: "degraded" },
          triage: { mode: "degraded", confidence: null },
        });
        expect(
          await count(
            "select count(*) from maint.intake_model_call where drafted_action_id = :id and status = 'provider_error'",
            [uuid("id", intake.id)],
          ),
        ).toBe(4);
        const response = await request(
          f.tenant1,
          "POST",
          `/maintenance/intakes/${intake.id}/confirm`,
          edits(intake, { transcript: "Typed transcript" }),
        );
        expect(response.status).toBe(201);
        const event = (
          await f.query(
            "select field_provenance from audit.audit_event where drafted_action_id = :id and event_type = 'ticket.reported'",
            [uuid("id", intake.id)],
          )
        ).rows[0];
        expect(parseJson(event?.field_provenance)).toMatchObject({
          "/transcript": "human_entered",
          "/description": "human_entered",
        });
      } finally {
        models.gateway = original;
      }
    }, 180000);
    it("AC-8 refuses foreign company, another tenant's media and another person's draft", async () => {
      await denial(f.tenantB, "/maintenance/intakes", report());
      await denial(
        f.tenant2,
        "/maintenance/intakes",
        report({ unitId: f.u2, photoMediaIds: [photo] }),
      );
      await denial(
        f.tenant2,
        `/maintenance/intakes/${ready.id}/confirm`,
        edits(ready),
      );
      const before = await count(
        "select count(*) from audit.audit_event where event_type = 'policy.denied'",
      );
      expect(
        (await request(f.tenant2, "GET", `/maintenance/intakes/${ready.id}`))
          .status,
      ).toBe(404);
      expect(
        await count(
          "select count(*) from audit.audit_event where event_type = 'policy.denied'",
        ),
      ).toBe(before + 1);
    }, 180000);
    it("AC-9 refuses accountant intake with one denial", async () => {
      await denial(f.accountant, "/maintenance/intakes", report(), 403);
    }, 180000);
    it("AC-10 invalid report, photos and category leave business rows unchanged", async () => {
      const intake = await create();
      const before = await count("select count(*) from audit.audit_event");
      for (const [path, body, status] of [
        ["/maintenance/intakes", report({ typedText: null }), 422],
        [
          "/maintenance/intakes",
          report({
            photoMediaIds: Array.from({ length: 4 }, () => randomUUID()),
          }),
          400,
        ],
        [
          `/maintenance/intakes/${intake.id}/confirm`,
          edits(intake, { category: "invalid" }),
          400,
        ],
        [
          "/maintenance/intakes",
          report({ photoMediaIds: [photo, photo] }),
          422,
        ],
      ] as const) {
        const response = await request(f.tenant1, "POST", path, body);
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({
          code: status === 422 ? "INVALID_INPUT" : "INVALID_REQUEST",
        });
      }
      expect(await count("select count(*) from audit.audit_event")).toBe(
        before,
      );
    }, 180000);
    it("AC-11 replays confirmation once and refuses a changed description under the same key", async () => {
      const intake = await create();
      const key = randomUUID();
      const body = edits(intake);
      const first = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/confirm`,
        body,
        key,
      );
      expect(first.status).toBe(201);
      const original: unknown = await first.json();
      const second = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/confirm`,
        body,
        key,
      );
      expect(second.status).toBe(201);
      expect(second.headers.get("Idempotent-Replayed")).toBe("true");
      expect(await second.json()).toEqual(original);
      const changed = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/confirm`,
        { ...body, description: "Changed" },
        key,
      );
      expect(changed.status).toBe(422);
      expect(await changed.json()).toMatchObject({
        code: "IDEMPOTENCY_KEY_REUSED",
      });
      expect(
        await count(
          "select count(*) from maint.ticket_intake where drafted_action_id = :id",
          [uuid("id", intake.id)],
        ),
      ).toBe(1);
      expect(
        await count(
          "select count(*) from audit.audit_event where drafted_action_id = :id and event_type = 'ticket.reported'",
          [uuid("id", intake.id)],
        ),
      ).toBe(1);
    }, 180000);
    it("AC-12 stale draft version creates no ticket", async () => {
      const intake = await create();
      const response = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/confirm`,
        edits(intake, { expectedVersion: 99 }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "STALE_VERSION",
        currentVersion: 1,
      });
      expect(
        await count(
          "select count(*) from maint.ticket_intake where drafted_action_id = :id",
          [uuid("id", intake.id)],
        ),
      ).toBe(0);
    }, 180000);
    it("AC-13 parallel confirmations with different keys create exactly one ticket", async () => {
      const intake = await create();
      const responses = await Promise.all([
        request(
          f.tenant1,
          "POST",
          `/maintenance/intakes/${intake.id}/confirm`,
          edits(intake),
        ),
        request(
          f.tenant1,
          "POST",
          `/maintenance/intakes/${intake.id}/confirm`,
          edits(intake),
        ),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      const loser = responses.find((response) => response.status === 409);
      expect(await loser?.json()).toMatchObject({
        code: "ALREADY_DECIDED",
        currentStatus: "committed",
      });
      expect(
        await count(
          "select count(*) from maint.ticket_intake where drafted_action_id = :id",
          [uuid("id", intake.id)],
        ),
      ).toBe(1);
      expect(
        await count(
          "select count(*) from audit.audit_event where drafted_action_id = :id and event_type = 'ticket.reported'",
          [uuid("id", intake.id)],
        ),
      ).toBe(1);
    }, 180000);
    it("AC-14 a covered unit version change commits draft expiry and no ticket", async () => {
      const intake = await create();
      await transaction(
        f.db,
        {
          companyId: f.a,
          subject: f.manager,
          channel: "mobile_form",
        },
        async (tx) => {
          const version = Number(
            (
              await tx.execute(
                "update estate.unit set unit_no = unit_no where company_id = :company and id = :unit returning version",
                [uuid("company", f.a), uuid("unit", f.u1)],
              )
            ).rows[0]?.version,
          );
          await audit(tx, {
            event: "unit.updated",
            subjectType: "unit",
            subjectId: f.u1,
            versionBefore: version - 1,
            versionAfter: version,
          });
        },
      );
      const response = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/confirm`,
        edits(intake),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "EXPIRED" });
      expect(
        (
          await f.query("select status from ai.drafted_action where id = :id", [
            uuid("id", intake.id),
          ])
        ).rows[0]?.status,
      ).toBe("expired");
      expect(await coverage(intake.id, "drafted_action.expired")).toEqual([
        "drafted_action:2",
      ]);
      expect(
        await count(
          "select count(*) from maint.ticket_intake where drafted_action_id = :id",
          [uuid("id", intake.id)],
        ),
      ).toBe(0);
    }, 180000);
    it("AC-15 rejection retains draft media and prevents confirmation", async () => {
      const media = await uploadFixtureMedia(f, {
        kind: "photo",
        bytes: Buffer.from("synthetic rejected photo"),
      });
      const intake = await create({ photoMediaIds: [media] });
      const response = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/reject`,
        { expectedVersion: 1, reason: null },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intake: { status: "rejected" },
      });
      expect(
        (
          await f.query(
            "select reason from audit.audit_event where subject_id = :id and event_type = 'drafted_action.rejected'",
            [uuid("id", intake.id)],
          )
        ).rows[0]?.reason,
      ).toBe("discarded_by_reporter");
      expect(
        (
          await f.query(
            "select drafted_action_id, ticket_id from maint.media where id = :id",
            [uuid("id", media)],
          )
        ).rows[0],
      ).toMatchObject({ drafted_action_id: intake.id, ticket_id: null });
      expect(await coverage(intake.id, "drafted_action.rejected")).toEqual([
        "drafted_action:2",
      ]);
      const confirm = await request(
        f.tenant1,
        "POST",
        `/maintenance/intakes/${intake.id}/confirm`,
        edits(intake),
      );
      expect(confirm.status).toBe(409);
      expect(await confirm.json()).toMatchObject({
        code: "ALREADY_DECIDED",
        currentStatus: "rejected",
      });
    }, 180000);
    it("AC-16 refuses media already linked to an intake", async () => {
      const response = await request(
        f.tenant1,
        "POST",
        "/maintenance/intakes",
        report({ photoMediaIds: [photo] }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "MEDIA_IN_USE",
        field: "photoMediaIds",
      });
    }, 180000);
    it("expires a ready draft older than twenty-four hours before validating edits", async () => {
      const intake = await create();
      clockOffset = 25 * 60 * 60 * 1000;
      let response: Response;
      try {
        response = await request(
          f.tenant1,
          "POST",
          `/maintenance/intakes/${intake.id}/confirm`,
          { expectedVersion: 1, category: "invalid" },
        );
      } finally {
        clockOffset = 0;
      }
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "EXPIRED" });
      expect(await coverage(intake.id, "drafted_action.expired")).toEqual([
        "drafted_action:2",
      ]);
      expect(
        await count(
          "select count(*) from maint.ticket_intake where drafted_action_id = :id",
          [uuid("id", intake.id)],
        ),
      ).toBe(0);
    }, 180000);
    it("AC-17 verifies company A and B audit chains after commands and refusals", async () => {
      for (const company of [f.a, f.b])
        expect(
          (
            await f.query(
              "select * from audit.verify_chain(:company)",
              [uuid("company", company)],
              company,
            )
          ).rows[0]?.ok,
        ).toBe(true);
    }, 180000);
  },
);
