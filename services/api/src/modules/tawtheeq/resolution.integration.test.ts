import { randomUUID } from "node:crypto";
import { withSystemTx } from "@aqarak/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createModelGateway } from "../../models/gateway";
import { DOCUMENT_FIELD_CATALOGUE } from "../../models/document-extraction";
import { ProviderUnavailableError } from "../../models/errors";
import {
  createFixture,
  confirmedFields,
  reviewed,
  type Fixture,
} from "./test-support/fixture";
import { rows, number, jsonValue } from "./storage";
const integration =
  process.env.AQARAK_INTEGRATION === "1" ? describe : describe.skip;
const active: Fixture[] = [];
async function fixture(
  options: Parameters<typeof createFixture>[0] = {},
): Promise<Fixture> {
  const f = await createFixture(options);
  active.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of active.splice(0)) f.deps.s3.destroy();
});
async function problem(
  response: Response,
  status: number,
  code: string,
  domainCode?: string,
): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(status);
  expect(await response.json()).toMatchObject({
    code,
    ...(domainCode ? { domainCode } : {}),
  });
}
function route(f: Fixture, name: string): string {
  return `/${f.recordId}/${name}`;
}
integration(
  "Tawtheeq extraction and resolution against the isolated database",
  { timeout: 180000 },
  () => {
    it("AC-8 extracts outside transactions, replays without inference, persists pipeline events, and degrades safely", async () => {
      const f = await fixture();
      await f.upload();
      const leaseVersions = () =>
        f.tx((tx) =>
          rows(
            tx,
            "select count(*) as count from audit.entity_version where company_id=:company::uuid and subject_type in ('contract','contract_version','tawtheeq_record','tawtheeq_review','discrepancy','approval')",
            z.object({ count: number }),
            { company: f.companyId },
          ),
        );
      const beforeLease = await leaseVersions();
      const firstKey = randomUUID();
      let failPrimary = false;
      let failAll = false;
      let attempts = 0;
      f.deps.gateway = createModelGateway({
        registry: f.deps.registry,
        now: () => new Date(),
        transcriptionAdapters: {},
        structuredAdapters: {
          openai_responses: {
            async generate(input) {
              expect(f.activeTransactions.size).toBe(0);
              await f.tx((tx) =>
                tx.execute(
                  "select id from core.company where id=:company::uuid for update nowait",
                  [{ name: "company", value: f.companyId }],
                ),
              );
              if (attempts === 0) {
                const pending = await f.request(
                  route(f, "extraction"),
                  {},
                  "manager",
                  firstKey,
                );
                expect(pending.status).toBe(503);
              }
              attempts++;
              if (
                failAll ||
                (failPrimary &&
                  input.candidate.modelId ===
                    f.deps.registry.classes.mc2_contract_understanding
                      .candidates[
                      f.deps.registry.classes.mc2_contract_understanding.primary
                    ]?.modelId)
              )
                throw new ProviderUnavailableError();
              const planted: Record<string, string> = {
                contract_number: "SYNTHETIC-2026-711",
                registration_date: "2026-08-14",
                tenant_id_number: "784196400029904",
                landlord_name_en: "Omar Al Nuaimi",
                tenant_name_en: "Mohammed Farouk",
                annual_rent: "220000.00",
                security_deposit: "20300.00",
                start_date: "2026-08-13",
                end_date: "2027-08-12",
                property_usage: "RESIDENTIAL",
              };
              return {
                text: JSON.stringify({
                  fields: Object.fromEntries(
                    DOCUMENT_FIELD_CATALOGUE.tawtheeq_contract.map((field) => [
                      field.name,
                      planted[field.name]
                        ? {
                            value: planted[field.name],
                            evidence: planted[field.name],
                            null_reason: null,
                          }
                        : {
                            value: null,
                            evidence: null,
                            null_reason: "absent",
                          },
                    ]),
                  ),
                }),
                usage: {
                  inputTokens: 10,
                  outputTokens: 20,
                  reasoningTokens: 0,
                  audioSeconds: 0,
                },
                modelEcho: input.candidate.modelId,
                finish: "completed",
              };
            },
          },
        },
      });
      const first = await f.request(
        route(f, "extraction"),
        {},
        "manager",
        firstKey,
      );
      expect(first.status, await first.clone().text()).toBe(200);
      const firstResult: unknown = await first.json();
      expect(firstResult).toMatchObject({
        status: "succeeded",
        registryEntry: "mc2_contract_understanding.primary",
        confidenceLabel: "uncalibrated",
      });
      expect(attempts).toBe(1);
      const firstEvents = await f.events();
      const replay = await f.request(
        route(f, "extraction"),
        {},
        "manager",
        firstKey,
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await replay.json()).toEqual(firstResult);
      expect(attempts).toBe(1);
      expect(await f.events()).toEqual(firstEvents);
      await problem(
        await f.request(
          route(f, "extraction"),
          { changed: true },
          "manager",
          firstKey,
        ),
        422,
        "IDEMPOTENCY_KEY_REUSED",
      );
      failPrimary = true;
      if (!f.deps.pipelineDatabase)
        throw new Error("Expected pipeline connection");
      const fallbackKey = randomUUID();
      vi.spyOn(f.deps.pipelineDatabase, "begin").mockRejectedValueOnce(
        new Error("Synthetic persistence interruption"),
      );
      const interrupted = await f.request(
        route(f, "extraction"),
        {},
        "manager",
        fallbackKey,
      );
      expect(interrupted.status).toBe(503);
      expect(attempts).toBe(3);
      const fallback = await f.request(
        route(f, "extraction"),
        {},
        "manager",
        fallbackKey,
      );
      expect(fallback.status, await fallback.clone().text()).toBe(200);
      expect(fallback.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await fallback.json()).toMatchObject({
        status: "succeeded",
        registryEntry: "mc2_contract_understanding.fallback",
      });
      expect(attempts).toBe(3);
      failAll = true;
      const version = (await f.view()).version;
      const degraded = await f.request(route(f, "extraction"), {});
      expect(await degraded.json()).toMatchObject({
        status: "degraded",
        degradedMode: "manual_entry",
        fields: {},
      });
      expect(attempts).toBe(5);
      expect((await f.view()).version).toBe(version);
      const events = await f.events();
      expect(
        events.filter((event) => event.event_type === "model_call.created"),
      ).toHaveLength(5);
      expect(
        events.filter((event) => event.event_type === "extraction.created"),
      ).toHaveLength(2);
      expect(
        events
          .filter((event) =>
            ["model_call.created", "extraction.created"].includes(
              event.event_type,
            ),
          )
          .every(
            (event) =>
              event.initiator === "pipeline" && event.channel === "system",
          ),
      ).toBe(true);
      const calls = await f.tx((tx) =>
        rows(
          tx,
          "select count(*) as count from ai.model_call where company_id=:company::uuid",
          z.object({ count: number }),
          { company: f.companyId },
        ),
      );
      expect(calls[0]?.count).toBe(5);
      const pipeline = await withSystemTx(
        f.deps.pipelineDatabase,
        { companyId: f.companyId },
        async (tx) => {
          const role = await tx.execute("select current_user");
          const extractions = await rows(
            tx,
            "select id from ai.extraction where company_id=:company::uuid",
            z.object({ id: z.uuid() }),
            { company: f.companyId },
          );
          const foreign = await tx.execute(
            "select company_id from audit.entity_version where company_id<>:company::uuid union all select company_id from audit.event_subject where company_id<>:company::uuid union all select company_id from audit.audit_event where company_id<>:company::uuid",
            [{ name: "company", value: f.companyId }],
          );
          return {
            role: role.rows[0]?.current_user,
            extractions,
            foreign: foreign.rows,
          };
        },
      );
      expect(pipeline.role).toBe("aqarak_pipeline");
      expect(pipeline.extractions).toHaveLength(2);
      expect(pipeline.foreign).toEqual([]);
      expect(await leaseVersions()).toEqual(beforeLease);
    });
    it("AC-9 registers a fully matched manager review", async () => {
      const f = await fixture();
      const result = await reviewed(f, confirmedFields());
      expect(result).toMatchObject({
        workflowState: "registered",
        tawtheeqNumber: "SYNTHETIC-2026-711",
        registeredOn: "2026-08-14",
        document: { reviewStatus: "accepted" },
      });
      expect(result.comparison.every((item) => item.status === "match")).toBe(
        true,
      );
      const reviews = await f.tx((tx) =>
        rows(
          tx,
          "select outcome from lease.tawtheeq_review where company_id=:company::uuid",
          z.object({ outcome: z.string() }),
          { company: f.companyId },
        ),
      );
      expect(reviews[0]?.outcome).toBe("matched");
    });
    it("AC-10 rejects the first identity mismatch and records both domain events", async () => {
      const f = await fixture();
      const fields = confirmedFields();
      fields.tenant_id_number.value = "784000000000002";
      const result = await reviewed(f, fields);
      expect(result).toMatchObject({
        workflowState: "awaiting_registration",
        document: { reviewStatus: "rejected" },
      });
      expect(result.document?.rejectReason).toContain("tenant_id_number");
      expect(
        (await f.events()).slice(-2).map((event) => event.event_type),
      ).toEqual([
        "tawtheeq_record.upload_rejected",
        "tawtheeq_record.awaiting_registration",
      ]);
      expect(
        (await f.events()).find(
          (event) => event.event_type === "tawtheeq_record.upload_rejected",
        )?.reason,
      ).toContain("tenant_id_number");
    });
    it("AC-11 opens material rent and minor formatting differences without changing the contract", async () => {
      const f = await fixture({ annualRentFils: 7000000 });
      const fields = confirmedFields(7200000);
      fields.owner_name = { value: "OMAR AL NUAIMI", provenance: "manual" };
      const result = await reviewed(f, fields);
      expect(result.workflowState).toBe("discrepancies_open");
      expect(result.contract.currentVersionId).toBe(f.contractVersionId);
      expect(result.discrepancies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "annual_rent_fils",
            class: "material",
            contractValue: 7000000,
            registeredValue: 7200000,
          }),
        ]),
      );
      expect(result.comparison).toContainEqual({
        field: "owner_name",
        status: "format_only",
      });
      expect(result.discrepancies).toContainEqual(
        expect.objectContaining({ field: "owner_name", class: "minor" }),
      );
      expect(result.contract.annualRentFils).toBe(7000000);
    });
    it("AC-12 adopts rent without an owner gate and notifies the tenant", async () => {
      const f = await fixture({
        frozenOwnerGate: false,
        annualRentFils: 7000000,
      });
      const fields = confirmedFields(7200000);
      fields.owner_name = { value: "OMAR AL NUAIMI", provenance: "manual" };
      const review = await reviewed(f, fields);
      const result = await f.post("resolutions", {
        expectedVersion: review.version,
        choices: review.discrepancies.map((item) => ({
          discrepancyId: item.id,
          kind: "adopt",
          reason: "Registered rent is authoritative",
        })),
      });
      expect(result).toMatchObject({
        workflowState: "registered",
        contract: { annualRentFils: 7200000 },
      });
      expect(result.contract.currentVersionId).not.toBe(f.contractVersionId);
      expect(result.contract.currentVersionId).toBe(
        result.adoption?.contractVersionId,
      );
      const events = await f.events();
      const resolutionEvents = events.filter(
        (event) => event.event_type === "tawtheeq.discrepancy_resolved",
      );
      expect(resolutionEvents).toHaveLength(2);
      expect(
        resolutionEvents.every(
          (event) => event.reason === "Registered rent is authoritative",
        ),
      ).toBe(true);
      expect(resolutionEvents[0]?.reason).toBe(
        "Registered rent is authoritative",
      );
      expect(resolutionEvents.map((event) => event.details)).toContainEqual(
        expect.objectContaining({
          field: "annual_rent_fils",
          contractValue: 7000000,
          registeredValue: 7200000,
        }),
      );
      const notifications = await f.tx((tx) =>
        rows(
          tx,
          // I inspect committed outbox snapshots because the application cannot read the delivery queue.
          "select snapshot->'payload' as payload from audit.entity_version where company_id=:company::uuid and subject_type='outbox' and snapshot->>'topic'='notification.tawtheeq'",
          z.object({ payload: jsonValue }),
          { company: f.companyId },
        ),
      );
      expect(notifications.map((item) => item.payload)).toContainEqual(
        expect.objectContaining({
          recipientRole: "tenant",
          recordId: f.recordId,
        }),
      );
    });
    it("AC-13 gates material adoption on the owner's own-session approval", async () => {
      const f = await fixture({ annualRentFils: 7000000 });
      const review = await reviewed(f, confirmedFields(7200000));
      const pending = await f.post("resolutions", {
        expectedVersion: review.version,
        choices: review.discrepancies.map((item) => ({
          discrepancyId: item.id,
          kind: "adopt",
          reason: "Correct registered rent",
        })),
      });
      expect(pending).toMatchObject({
        workflowState: "awaiting_owner_reapproval",
        contract: { currentVersionId: f.contractVersionId },
        adoption: { ownerApproval: { status: "requested" } },
      });
      await problem(
        await f.request(route(f, "owner-reapproval"), {
          expectedVersion: pending.version,
          decision: "approve",
        }),
        403,
        "NOT_PERMITTED",
      );
      const result = await f.post(
        "owner-reapproval",
        { expectedVersion: pending.version, decision: "approve" },
        "owner",
      );
      expect(result.workflowState).toBe("registered");
      expect(result.contract.currentVersionId).toBe(
        pending.adoption?.contractVersionId,
      );
    });
    it("AC-13 requires a return reason and voids the owner's approval request", async () => {
      const f = await fixture({ annualRentFils: 7000000 });
      const review = await reviewed(f, confirmedFields(7200000));
      const pending = await f.post("resolutions", {
        expectedVersion: review.version,
        choices: review.discrepancies.map((item) => ({
          discrepancyId: item.id,
          kind: "adopt",
          reason: "Correct registered rent",
        })),
      });
      await problem(
        await f.request(
          route(f, "owner-reapproval"),
          { expectedVersion: pending.version, decision: "return" },
          "owner",
        ),
        422,
        "REASON_REQUIRED",
        "REASON_REQUIRED",
      );
      const result = await f.post(
        "owner-reapproval",
        {
          expectedVersion: pending.version,
          decision: "return",
          reason: "Please recheck the registered amount",
        },
        "owner",
      );
      expect(result.workflowState).toBe("discrepancies_open");
      expect(result.discrepancies.every((item) => item.status === "open")).toBe(
        true,
      );
      const approvals = await f.tx((tx) =>
        rows(
          tx,
          "select status from lease.approval where company_id=:company::uuid and kind='owner_reapproval'",
          z.object({ status: z.string() }),
          { company: f.companyId },
        ),
      );
      expect(approvals[0]?.status).toBe("voided");
    });
    it("AC-14 cancels and re-registers without changing the contract and refuses rent equivalence", async () => {
      const f = await fixture({ annualRentFils: 7000000 });
      const reviewedRent = await reviewed(f, confirmedFields(7200000));
      const discrepancy = reviewedRent.discrepancies[0];
      if (!discrepancy) throw new Error("Expected rent discrepancy");
      await problem(
        await f.request(route(f, "resolutions"), {
          expectedVersion: reviewedRent.version,
          choices: [
            {
              discrepancyId: discrepancy.id,
              kind: "mark_equivalent",
              basis: "formatting",
              reason: "Same amount",
            },
          ],
        }),
        422,
        "VALIDATION_FAILED",
        "MARK_EQUIVALENT_NOT_ALLOWED",
      );
      const cancelled = await f.post("resolutions", {
        expectedVersion: reviewedRent.version,
        choices: [
          {
            discrepancyId: discrepancy.id,
            kind: "cancel_and_reregister",
            reason: "Correct the portal registration",
          },
        ],
      });
      expect(cancelled.workflowState).toBe("awaiting_registration");
      expect(cancelled.contract.currentVersionId).toBe(f.contractVersionId);
    });
    it("AC-14 accepts formatting equivalence for a minor name difference", async () => {
      const minor = await fixture();
      const fields = confirmedFields();
      fields.owner_name = { value: "OMAR AL NUAIMI", provenance: "manual" };
      const comparison = await reviewed(minor, fields);
      const result = await minor.post("resolutions", {
        expectedVersion: comparison.version,
        choices: comparison.discrepancies.map((item) => ({
          discrepancyId: item.id,
          kind: "mark_equivalent",
          basis: "formatting",
          reason: "Only letter case differs",
        })),
      });
      expect(result.workflowState).toBe("registered");
      expect(result.contract.currentVersionId).toBe(minor.contractVersionId);
    });
  },
);
