import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { expect } from "vitest";
import { createModelGateway } from "../../models/gateway";
import { DOCUMENT_FIELD_CATALOGUE } from "../../models/document-extraction";
import { createFixture, png, type Fixture } from "./test-support/fixture";
import { execute, one, number, jsonValue } from "./storage";
import { writeAuditEvent, coverTransactionVersions } from "../audit/kernel";
import type { ConfirmBody } from "./retroactive-schemas";
export const intakeViewSchema = z.object({
  draftId: z.uuid(),
  version: z.number(),
  status: z.string(),
  proposal: z.record(z.string(), z.unknown()),
  document: z
    .object({
      documentVersionId: z.uuid(),
      processingStatus: z.string(),
      reviewStatus: z.string(),
    })
    .nullable(),
  candidates: z.object({
    units: z.array(z.unknown()),
    owners: z.array(z.unknown()),
    tenants: z.array(z.object({ id: z.uuid() })),
  }),
});
export type IntakeView = z.infer<typeof intakeViewSchema>;
export async function createRetroactiveFixture(): Promise<Fixture> {
  return createFixture({ withoutContract: true });
}
export async function createDraft(
  f: Fixture,
): Promise<{ draftId: string; version: number }> {
  const response = await f.request("/retroactive", {});
  expect(response.status, await response.clone().text()).toBe(201);
  return z
    .object({ draftId: z.uuid(), version: z.number() })
    .parse(await response.json());
}
export async function getDraft(
  f: Fixture,
  draftId: string,
): Promise<IntakeView> {
  const response = await f.request(`/retroactive/${draftId}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return intakeViewSchema.parse(await response.json());
}
export async function uploadDraft(
  f: Fixture,
  draft: { draftId: string; version: number },
  tag: string | null = "NO_THREATS_FOUND",
): Promise<IntakeView> {
  const presign = await f.request(`/retroactive/${draft.draftId}/uploads`, {
    expectedVersion: draft.version,
    fileName: "synthetic-retroactive.png",
    contentType: "image/png",
    byteSize: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
  expect(presign.status, await presign.clone().text()).toBe(201);
  const value = z
    .object({
      documentVersionId: z.uuid(),
      version: z.number(),
      upload: z.object({
        url: z.string(),
        headers: z.record(z.string(), z.string()),
      }),
    })
    .parse(await presign.json());
  const put = await fetch(value.upload.url, {
    method: "PUT",
    headers: value.upload.headers,
    body: png,
  });
  expect(put.status, await put.clone().text()).toBe(200);
  const pinned = {
    Bucket: f.deps.buckets.documents ?? "",
    Key: `${f.deps.keyPrefix}companies/${f.companyId}/tawtheeq/${draft.draftId}/${value.documentVersionId}`,
    VersionId: put.headers.get("x-amz-version-id") ?? undefined,
  };
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const scanned = await f.deps.s3.send(new GetObjectTaggingCommand(pinned));
    if (
      scanned.TagSet?.some(
        (entry) => entry.Key === "GuardDutyMalwareScanStatus",
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await f.deps.s3.send(
    new PutObjectTaggingCommand({
      ...pinned,
      Tagging: {
        TagSet: tag ? [{ Key: "GuardDutyMalwareScanStatus", Value: tag }] : [],
      },
    }),
  );
  const completed = await f.request(
    `/retroactive/${draft.draftId}/uploads/${value.documentVersionId}/complete`,
    { expectedVersion: value.version },
  );
  expect(completed.status, await completed.clone().text()).toBe(200);
  return intakeViewSchema.parse(await completed.json());
}
export function confirmation(f: Fixture, draft: IntakeView): ConfirmBody {
  if (!draft.document) throw new Error("A source document is required");
  return {
    expectedVersion: draft.version,
    ownerId: f.ownerId,
    unitId: f.unitId,
    tenantId: f.tenantId,
    documentVersionId: draft.document.documentVersionId,
    fields: {
      unt_number: { value: "711", provenance: "manual" },
      owner_id_number: { value: "784000000000001", provenance: "manual" },
      tenant_id_number: { value: "784196400029904", provenance: "extracted" },
      term_start: { value: "2025-01-01", provenance: "extracted" },
      term_end: { value: "2025-12-31", provenance: "extracted" },
      total_fils: { value: 12000000, provenance: "edited" },
      vat_bp: { value: 0, provenance: "manual" },
      payment_schedule: {
        value: [{ seqNo: 1, amountFils: 12000000, vatFils: 0 }],
        provenance: "manual",
      },
      tawtheeq_number: { value: "SYNTHETIC-RC-711", provenance: "extracted" },
      registered_on: { value: "2025-01-02", provenance: "manual" },
    },
  };
}
export function structuredAdapter(
  f: Fixture,
  beforeGenerate?: () => Promise<void>,
): { calls: number } {
  const stats = { calls: 0 };
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
          stats.calls++;
          await beforeGenerate?.();
          const planted: Record<string, string> = {
            contract_number: "SYNTHETIC-RC-711",
            registration_date: "2025-01-02",
            tenant_id_number: "784196400029904",
            annual_rent: "120000.00",
            start_date: "2025-01-01",
            end_date: "2025-12-31",
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
                    : { value: null, evidence: null, null_reason: "absent" },
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
  return stats;
}
async function auditSnapshot(
  f: Fixture,
): Promise<{ business: unknown; events: string[] }> {
  return f.tx(async (tx) => {
    const snapshot = await one(
      tx,
      `select
      coalesce((select jsonb_agg(jsonb_build_array(subject_type,subject_id,subject_version) order by subject_type,subject_id,subject_version) from audit.entity_version where company_id=:company::uuid),'[]'::jsonb) as versions,
      coalesce((select jsonb_agg(jsonb_build_array(command_type,key,response) order by command_type,key) from ops.idempotency_key where company_id=:company::uuid),'[]'::jsonb) as keys,
      coalesce((select jsonb_agg(event_type order by seq) from audit.audit_event where company_id=:company::uuid),'[]'::jsonb) as events`,
      z.object({
        versions: jsonValue,
        keys: jsonValue,
        events: jsonValue.pipe(z.array(z.string())),
      }),
      { company: f.companyId },
    );
    return {
      business: { versions: snapshot.versions, keys: snapshot.keys },
      events: snapshot.events,
    };
  });
}
export async function businessSnapshot(f: Fixture): Promise<unknown> {
  return (await auditSnapshot(f)).business;
}
export async function assertDenial(
  f: Fixture,
  request: () => Promise<Response>,
  expected: {
    status: number;
    domainCode?: string;
    code?: string;
    field?: string;
    missing?: string[];
  },
): Promise<void> {
  const before = await auditSnapshot(f);
  const response = await request();
  expect(response.status, await response.clone().text()).toBe(expected.status);
  expect(await response.json()).toMatchObject(expected);
  const after = await auditSnapshot(f);
  expect(after.business).toEqual(before.business);
  expect(after.events.slice(before.events.length)).toEqual(["policy.denied"]);
}
export async function removeTenantLink(f: Fixture): Promise<void> {
  await f.tx(async (tx) => {
    await execute(
      tx,
      "update party.tenant set linked_account_id=null where company_id=:company::uuid and id=:id::uuid",
      { company: f.companyId, id: f.tenantId },
    );
    const event = await writeAuditEvent(tx, f.companyId, {
      eventType: "tenant.updated",
      actorAccountId: f.accounts.manager,
      actorRole: "manager",
      initiator: "person",
      channel: "web_form",
      subjectType: "tenant",
      subjectId: f.tenantId,
      versionBefore: 1,
      versionAfter: 2,
      traceId: randomUUID(),
    });
    await coverTransactionVersions(tx, f.companyId, event.eventId);
  });
}
export async function contractCount(f: Fixture): Promise<number> {
  return f.tx(
    async (tx) =>
      (
        await one(
          tx,
          "select count(*) as count from lease.contract where company_id=:company::uuid",
          z.object({ count: number }),
          { company: f.companyId },
        )
      ).count,
  );
}
