import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { rows, one, number, jsonValue } from "./storage";
import { contractContentHash } from "./comparison";
import type { Fixture } from "./test-support/fixture";
import {
  createRetroactiveFixture,
  createDraft,
  uploadDraft,
  getDraft,
  confirmation,
  structuredAdapter,
  businessSnapshot,
  assertDenial,
  removeTenantLink,
  contractCount,
  intakeViewSchema,
} from "./retroactive-test-support";
const integration =
  process.env.AQARAK_INTEGRATION === "1" ? describe : describe.skip;
const active: Fixture[] = [];
async function fixture(): Promise<Fixture> {
  const f = await createRetroactiveFixture();
  active.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of active.splice(0)) f.deps.s3.destroy();
});
integration(
  "Retroactive Tawtheeq IN8R evidence against the isolated database",
  { timeout: 600000 },
  () => {
    it("AC-1 concludes a matched intake atomically with pipeline extraction and AC-05.5 audit coverage", async () => {
      const f = await fixture();
      expect(await contractCount(f)).toBe(0);
      const initial = await createDraft(f);
      const draft = await uploadDraft(f, initial);
      const stats = structuredAdapter(f);
      const key = randomUUID(),
        extractionBody = { expectedVersion: draft.version };
      const extracted = await f.request(
        `/retroactive/${draft.draftId}/extraction`,
        extractionBody,
        "manager",
        key,
      );
      expect(extracted.status, await extracted.clone().text()).toBe(200);
      const ready = intakeViewSchema.parse(await extracted.json());
      expect(ready.status).toBe("ready");
      expect(ready.candidates.tenants).toEqual([
        expect.objectContaining({ id: f.tenantId }),
      ]);
      expect(ready.candidates.units).toEqual([]);
      expect(ready.candidates.owners).toEqual([]);
      expect(ready.proposal).toHaveProperty("tenant_id_number");
      expect(await contractCount(f)).toBe(0);
      const beforeReplay = await businessSnapshot(f);
      const replayExtraction = await f.request(
        `/retroactive/${draft.draftId}/extraction`,
        extractionBody,
        "manager",
        key,
      );
      expect(
        replayExtraction.status,
        await replayExtraction.clone().text(),
      ).toBe(200);
      expect(replayExtraction.headers.get("Idempotency-Replayed")).toBe("true");
      expect(stats.calls).toBe(1);
      expect(await businessSnapshot(f)).toEqual(beforeReplay);
      const response = await f.request(
        `/retroactive/${draft.draftId}/confirm`,
        confirmation(f, ready),
      );
      expect(response.status, await response.clone().text()).toBe(201);
      const result = z
        .object({
          id: z.uuid(),
          contractId: z.uuid(),
          scheduleActivation: z.string(),
          path: z.string(),
          workflowState: z.string(),
          portalStatus: z.string(),
          contract: z.object({
            contractNo: z.string(),
            status: z.string(),
            frozenOwnerGate: z.boolean(),
          }),
        })
        .parse(await response.json());
      expect(result).toMatchObject({
        scheduleActivation: "deferred_to_payments",
        path: "retroactive",
        workflowState: "registered",
        portalStatus: "registered",
        contract: { status: "concluded", frozenOwnerGate: false },
      });
      expect(result.contract.contractNo).toMatch(/^RC-\d{4}-\d{6}$/);
      await f.tx(async (tx) => {
        const p = {
          company: f.companyId,
          contract: result.contractId,
          draft: draft.draftId,
        };
        const contract = await one(
          tx,
          "select c.origin,c.status,c.tenant_id,v.* from lease.contract c join lease.contract_version v on v.company_id=c.company_id and v.id=c.current_version_id where c.company_id=:company::uuid and c.id=:contract::uuid",
          z.object({
            origin: z.string(),
            status: z.string(),
            tenant_id: z.uuid(),
            version_no: number,
            kind: z.string(),
            term_start: z.string(),
            term_end: z.string(),
            total_fils: number,
            vat_bp: number,
            frozen_owner_gate: z.boolean(),
            submitted_at: z.string(),
            content_hash: z.string(),
          }),
          p,
        );
        expect(contract).toMatchObject({
          origin: "retroactive",
          status: "concluded",
          tenant_id: f.tenantId,
          version_no: 1,
          kind: "standard",
          term_start: "2025-01-01",
          term_end: "2025-12-31",
          total_fils: 12000000,
          vat_bp: 0,
          frozen_owner_gate: false,
        });
        const unit = await one(
          tx,
          "select unit_id,blocks_unit,occupancy_start,occupancy_end from lease.contract_unit where company_id=:company::uuid and contract_id=:contract::uuid",
          z.object({
            unit_id: z.uuid(),
            blocks_unit: z.boolean(),
            occupancy_start: z.string(),
            occupancy_end: z.string(),
          }),
          p,
        );
        expect(unit).toEqual({
          unit_id: f.unitId,
          blocks_unit: true,
          occupancy_start: "2025-01-01",
          occupancy_end: "2025-12-31",
        });
        const approvals = await rows(
          tx,
          "select a.* from lease.approval a join lease.contract_version v on v.company_id=a.company_id and v.id=a.contract_version_id where v.company_id=:company::uuid and v.contract_id=:contract::uuid",
          z.object({
            slot: z.string(),
            kind: z.string(),
            status: z.string(),
            subject_hash: z.string(),
            approver_account_id: z.uuid(),
          }),
          p,
        );
        expect(approvals).toEqual([
          {
            slot: "manager",
            kind: "retroactive_confirmation",
            status: "approved",
            subject_hash: contract.content_hash,
            approver_account_id: f.accounts.manager,
          },
        ]);
        const committed = await one(
          tx,
          "select status,field_provenance,payload,extraction_id,initiator,channel,for_account_id from ai.drafted_action where company_id=:company::uuid and id=:draft::uuid",
          z.object({
            status: z.string(),
            field_provenance: jsonValue,
            payload: jsonValue.pipe(
              z.object({
                confirmedTerms: z.record(z.string(), z.json()),
                contentHash: z.string(),
                confirmation: z.json(),
              }),
            ),
            extraction_id: z.uuid(),
            initiator: z.string(),
            channel: z.string(),
            for_account_id: z.uuid(),
          }),
          p,
        );
        expect(committed).toMatchObject({
          status: "committed",
          initiator: "person",
          channel: "web_form",
          for_account_id: f.accounts.manager,
          field_provenance: {
            unt_number: "human_entered",
            tenant_id_number: "ai_confirmed",
            total_fils: "ai_edited",
          },
        });
        expect(contractContentHash(committed.payload.confirmedTerms)).toBe(
          contract.content_hash,
        );
        const notifications = await rows(
          tx,
          "select snapshot->'payload' as payload from audit.entity_version where company_id=:company::uuid and subject_type='outbox' order by snapshot->'payload'->>'recipientRole'",
          z.object({ payload: jsonValue }),
          p,
        );
        expect(notifications).toEqual(
          ["owner", "tenant"].map((role) => ({
            payload: {
              companyId: f.companyId,
              contractId: result.contractId,
              recordId: result.id,
              recipientAccountId:
                role === "owner" ? f.accounts.owner : f.accounts.tenant,
              recipientRole: role,
              template: "retroactive_contract_recorded",
            },
          })),
        );
        const document = await one(
          tx,
          "select d.subject_type,d.subject_id,d.doc_type,v.review_status from doc.document d join doc.document_version v on v.company_id=d.company_id and v.id=d.current_version_id where d.company_id=:company::uuid and d.subject_id=:draft::uuid",
          z.object({
            subject_type: z.string(),
            subject_id: z.uuid(),
            doc_type: z.string(),
            review_status: z.string(),
          }),
          p,
        );
        expect(document).toEqual({
          subject_type: "drafted_action",
          subject_id: draft.draftId,
          doc_type: "tawtheeq",
          review_status: "accepted",
        });
        const events = await rows(
          tx,
          "select event_id,event_type,tx_id,field_provenance from audit.audit_event where company_id=:company::uuid and drafted_action_id=:draft::uuid and event_type in ('contract.created','approval.approved','contract.concluded','tawtheeq_record.registered') order by seq",
          z.object({
            event_id: z.uuid(),
            event_type: z.string(),
            tx_id: z.coerce.string(),
            field_provenance: jsonValue.nullable(),
          }),
          p,
        );
        expect(events.map((event) => event.event_type)).toEqual([
          "contract.created",
          "approval.approved",
          "contract.concluded",
          "tawtheeq_record.registered",
        ]);
        expect(new Set(events.map((event) => event.tx_id)).size).toBe(1);
        expect(events[0]?.field_provenance).toEqual(committed.field_provenance);
        const primary = await rows(
          tx,
          "select distinct s.event_id from audit.event_subject s join audit.entity_version v on v.company_id=s.company_id and v.subject_type=s.subject_type and v.subject_id=s.subject_id and v.subject_version=s.subject_version where v.company_id=:company::uuid and v.tx_id=:tx::bigint",
          z.object({ event_id: z.uuid() }),
          { ...p, tx: events[0]?.tx_id ?? "0" },
        );
        expect(primary).toEqual([{ event_id: events[0]?.event_id }]);
        expect(
          (
            await one(
              tx,
              "select count(*) as count from audit.entity_version v where company_id=:company::uuid and not exists(select 1 from audit.event_subject s where s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version)",
              z.object({ count: number }),
              p,
            )
          ).count,
        ).toBe(0);
        const chain = await tx.execute(
          "select * from audit.verify_chain(:company::uuid)",
          [{ name: "company", value: f.companyId }],
        );
        expect(chain.rows[0]).toMatchObject({ ok: true });
        expect(
          (
            await one(
              tx,
              "select count(*) as count from money.instalment where company_id=:company::uuid",
              z.object({ count: number }),
              p,
            )
          ).count,
        ).toBe(0);
      });
    });
    it("AC-2 refuses every missing confirmation field, unclean evidence and an unlinked tenant without writes", async () => {
      const f = await fixture();
      const pending = await uploadDraft(f, await createDraft(f), null);
      const body = confirmation(f, pending),
        route = `/retroactive/${pending.draftId}/confirm`;
      for (const field of Object.keys(body.fields)) {
        const fields = Object.fromEntries(
          Object.entries(body.fields).filter(([key]) => key !== field),
        );
        await assertDenial(f, () => f.request(route, { ...body, fields }), {
          status: 409,
          domainCode: "RETROACTIVE_EVIDENCE_MISSING",
          field: "manager_confirmation",
          missing: [field],
        });
      }
      await assertDenial(f, () => f.request(route, body), {
        status: 409,
        domainCode: "RETROACTIVE_EVIDENCE_MISSING",
        field: "registered_document",
      });
      await assertDenial(
        f,
        () =>
          f.request(`/retroactive/${pending.draftId}/extraction`, {
            expectedVersion: pending.version,
          }),
        {
          status: 409,
          domainCode: "RETROACTIVE_EVIDENCE_MISSING",
          field: "registered_document",
        },
      );
      const clean = await uploadDraft(f, await createDraft(f));
      await removeTenantLink(f);
      await assertDenial(
        f,
        () =>
          f.request(
            `/retroactive/${clean.draftId}/confirm`,
            confirmation(f, clean),
          ),
        {
          status: 409,
          domainCode: "RETROACTIVE_EVIDENCE_MISSING",
          field: "party_notifications",
        },
      );
      expect(await contractCount(f)).toBe(0);
    });
    it("AC-3 refuses exact identity mismatches and missing matched records without writes", async () => {
      const f = await fixture(),
        draft = await uploadDraft(f, await createDraft(f));
      const body = confirmation(f, draft),
        route = `/retroactive/${draft.draftId}/confirm`;
      for (const field of [
        "tenant_id_number",
        "owner_id_number",
        "unt_number",
      ] as const)
        await assertDenial(
          f,
          () =>
            f.request(route, {
              ...body,
              fields: {
                ...body.fields,
                [field]: { value: "different", provenance: "edited" },
              },
            }),
          { status: 422, domainCode: "IDENTITY_MISMATCH", field },
        );
      await assertDenial(
        f,
        () =>
          f.request(route, {
            ...body,
            ownerId: randomUUID(),
            unitId: randomUUID(),
            tenantId: randomUUID(),
          }),
        {
          status: 409,
          domainCode: "RETROACTIVE_EVIDENCE_MISSING",
          missing: ["owner", "tenant", "unit"],
        },
      );
    });
    it("AC-4 refuses overlapping terms through both IN10 and SQLSTATE 23P01 with complete rollback", async () => {
      const f = await fixture(),
        first = await uploadDraft(f, await createDraft(f));
      const success = await f.request(
        `/retroactive/${first.draftId}/confirm`,
        confirmation(f, first),
      );
      expect(success.status, await success.clone().text()).toBe(201);
      const second = await uploadDraft(f, await createDraft(f));
      const route = `/retroactive/${second.draftId}/confirm`,
        body = confirmation(f, second);
      await assertDenial(f, () => f.request(route, body), {
        status: 409,
        domainCode: "OVERLAPPING_CONTRACT",
      });
      // I hide the preflight result once so the real exclusion constraint supplies the refusal.
      const execute = f.deps.database.execute.bind(f.deps.database);
      vi.spyOn(f.deps.database, "execute").mockImplementation(
        (sql, parameters, transactionId) =>
          sql.startsWith("select contract_id,occupancy_start,occupancy_end")
            ? Promise.resolve({ rows: [], numberOfRecordsUpdated: 0 })
            : execute(sql, parameters, transactionId),
      );
      await assertDenial(f, () => f.request(route, body), {
        status: 409,
        domainCode: "OVERLAPPING_CONTRACT",
      });
      expect(await contractCount(f)).toBe(1);
    });
    it("AC-5 denies every intake command and read to wrong roles and hides company A from manager B", async () => {
      const f = await fixture(),
        draft = await createDraft(f),
        document = randomUUID();
      const commands = [
        "/retroactive",
        `/retroactive/${draft.draftId}/uploads`,
        `/retroactive/${draft.draftId}/uploads/${document}/complete`,
        `/retroactive/${draft.draftId}/extraction`,
        `/retroactive/${draft.draftId}/confirm`,
      ];
      for (const role of ["tenant", "owner", "accountant"] as const) {
        for (const route of commands)
          await assertDenial(f, () => f.request(route, {}, role), {
            status: 403,
            code: "NOT_PERMITTED",
          });
        await assertDenial(
          f,
          () => f.request(`/retroactive/${draft.draftId}`, undefined, role),
          { status: 403, code: "NOT_PERMITTED" },
        );
      }
      for (const route of commands)
        await assertDenial(
          f,
          async () => {
            const response = await f.request(route, {}, "managerB");
            const text = await response.clone().text();
            for (const value of [
              draft.draftId,
              f.ownerId,
              f.unitId,
              f.tenantId,
            ])
              expect(text).not.toContain(value);
            return response;
          },
          { status: 404, code: "NOT_FOUND" },
        );
      await assertDenial(
        f,
        () => f.request(`/retroactive/${draft.draftId}`, undefined, "managerB"),
        { status: 404, code: "NOT_FOUND" },
      );
      expect(await contractCount(f)).toBe(0);
    });
    it("AC-6 replays confirmation without a second contract and refuses stale draft commands", async () => {
      const f = await fixture(),
        draft = await uploadDraft(f, await createDraft(f));
      const route = `/retroactive/${draft.draftId}/confirm`,
        body = confirmation(f, draft);
      await assertDenial(
        f,
        () => f.request(route, { ...body, expectedVersion: 1 }),
        { status: 409, code: "STALE_VERSION" },
      );
      const key = randomUUID();
      const first = await f.request(route, body, "manager", key);
      expect(first.status, await first.clone().text()).toBe(201);
      const result: unknown = await first.json(),
        before = await businessSnapshot(f),
        events = (await f.events()).length;
      const replay = await f.request(route, body, "manager", key);
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await replay.json()).toEqual(result);
      expect(await businessSnapshot(f)).toEqual(before);
      expect((await f.events()).length).toBe(events);
      expect(await contractCount(f)).toBe(1);
      await assertDenial(f, () => f.request(route, body), {
        status: 409,
        code: "STALE_VERSION",
      });
      expect((await getDraft(f, draft.draftId)).status).toBe("committed");
    });
  },
);
