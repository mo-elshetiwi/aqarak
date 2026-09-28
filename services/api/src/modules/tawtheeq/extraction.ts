import { getConfig } from "../../config";
import { randomUUID } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { withCompanyTx, withSystemTx } from "@aqarak/db";
import { z } from "zod";
import {
  DOCUMENT_EXTRACTION_PROMPT,
  documentExtractionSchemaFor,
} from "../../models/document-extraction";
import { modelCallRecordSchema } from "../../models/contracts";
import {
  coverTransactionVersions,
  writeAuditEvent,
  Refusal,
  type CommandContext,
} from "../audit/kernel";
import type { TawtheeqDependencies } from "./dependencies";
import type { LoadedRecord } from "./repository";
import { execute, jsonValue, rows } from "./storage";
import { requireClean } from "./uploads";
import {
  compareFields,
  amountFils,
  type ComparedField,
  type FieldValue,
} from "./comparison";
import { commandEvent } from "./workflow";
export const proposalSchema = z.object({
  value: z.string().nullable(),
  evidence: z.string().nullable(),
  nullReason: z.string().nullable(),
});
export const proposalsSchema = z.record(z.string(), proposalSchema);
export const extractionResponse = z.object({
  status: z.enum(["succeeded", "degraded"]),
  degradedMode: z.string().nullable(),
  extractionId: z.uuid().nullable(),
  registryEntry: z.string(),
  confidenceLabel: z.literal("uncalibrated"),
  fields: proposalsSchema,
  comparisonPreview: z.array(z.unknown()),
});
const attemptSchema = z.object({
  id: z.uuid(),
  entry: z.string(),
  record: modelCallRecordSchema,
  fields: proposalsSchema.nullable(),
});
export const extractionEnvelope = z.object({
  response: extractionResponse,
  attempts: z.array(attemptSchema),
  companyId: z.uuid(),
  documentVersionId: z.uuid(),
  traceId: z.string(),
});
const fieldMap: Record<string, string> = {
  contract_number: "tawtheeq_number",
  registration_date: "registered_on",
  landlord_name_en: "owner_name",
  tenant_name_en: "tenant_name",
  tenant_id_number: "tenant_id_number",
  start_date: "term_start",
  end_date: "term_end",
  annual_rent: "annual_rent_fils",
  security_deposit: "deposit_fils",
  property_usage: "contract_type",
};
export function mapProposals(
  fields: Record<
    string,
    {
      value: string | null;
      evidence: string | null;
      null_reason: string | null;
    }
  >,
): z.infer<typeof proposalsSchema> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      fieldMap[field] ?? field,
      {
        value: value.value,
        evidence: value.evidence,
        nullReason: value.null_reason,
      },
    ]),
  );
}
export function proposedValues(
  fields: z.infer<typeof proposalsSchema>,
): Partial<Record<ComparedField, FieldValue>> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, proposal]) => [
      field,
      proposal.value !== null &&
      (field === "annual_rent_fils" || field === "deposit_fils")
        ? amountFils(proposal.value)
        : proposal.value,
    ]),
  );
}
export interface ExtractionInput {
  companyId: string;
  accountId: string;
  idempotencyKey: string;
  traceId: string;
  document: NonNullable<LoadedRecord["document"]>;
  basis: Partial<LoadedRecord["basis"]>;
  commandType?: string;
}
/** I reserve the command and snapshot its source before releasing the transaction. */
export async function prepareExtraction(
  ctx: CommandContext,
  data: LoadedRecord,
): Promise<ExtractionInput> {
  const document = requireClean(data);
  await commandEvent(ctx, data.record.id, "tawtheeq.extraction_requested", {
    details: { documentVersionId: document.id },
  });
  return {
    companyId: ctx.companyId,
    accountId: ctx.actor.account_id,
    idempotencyKey: ctx.idempotencyKey,
    traceId: ctx.traceId,
    document,
    basis: data.basis,
  };
}
/** I call storage and the provider without a database transaction or row lock. */
export async function extract(
  input: ExtractionInput,
  deps: TawtheeqDependencies,
): Promise<z.infer<typeof extractionEnvelope>> {
  const { document } = input;
  const classId = "mc2_contract_understanding";
  const entry = deps.registry.classes[classId];
  const result: z.infer<typeof extractionEnvelope> = {
    response: {
      status: "degraded",
      degradedMode: entry.degraded,
      extractionId: null,
      registryEntry: `${classId}.degraded`,
      confidenceLabel: "uncalibrated",
      fields: {},
      comparisonPreview: [],
    },
    attempts: [],
    companyId: input.companyId,
    documentVersionId: document.id,
    traceId: input.traceId,
  };
  if (deps.gateway && document.content_type !== "application/pdf") {
    if (!deps.pipelineDatabase)
      throw new Refusal(
        "UNAVAILABLE",
        null,
        "The pipeline database connection is required for extraction.",
      );
    const object = await deps.s3.send(
      new GetObjectCommand({
        Bucket: document.bucket,
        Key: document.s3_key,
        VersionId: document.s3_version_id ?? undefined,
      }),
    );
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) throw new Refusal("UNAVAILABLE", null);
    const deadline = Date.now() + getConfig().EXTRACTION_TIMEOUT_MS;
    for (const slot of ["primary", "fallback"] as const) {
      if (Date.now() >= deadline) break;
      const candidateId = entry[slot];
      if (!candidateId) continue;
      const output = await deps.gateway.generateStructured({
        classId,
        candidateId,
        promptId: DOCUMENT_EXTRACTION_PROMPT.id,
        promptVersion: DOCUMENT_EXTRACTION_PROMPT.version,
        instructions: DOCUMENT_EXTRACTION_PROMPT.instructions,
        userText: DOCUMENT_EXTRACTION_PROMPT.userTextFor("tawtheeq_contract"),
        images: [
          {
            bytes,
            mediaType: z
              .enum(["image/png", "image/jpeg"])
              .parse(document.content_type),
          },
        ],
        schemaId: "tawtheeq_contract_v1",
        schema: documentExtractionSchemaFor("tawtheeq_contract"),
        timeoutMs: Math.max(1, deadline - Date.now()),
      });
      const parsed = documentExtractionSchemaFor("tawtheeq_contract").safeParse(
        output.output,
      );
      const fields =
        parsed.success && output.record.status === "ok"
          ? mapProposals(parsed.data.fields)
          : null;
      const registryEntry = `${classId}.${slot}`;
      result.attempts.push({
        id: randomUUID(),
        entry: registryEntry,
        record: output.record,
        fields,
      });
      if (fields) {
        result.response = {
          status: "succeeded",
          degradedMode: null,
          extractionId: randomUUID(),
          registryEntry,
          confidenceLabel: "uncalibrated",
          fields,
          comparisonPreview: compareFields(input.basis, proposedValues(fields)),
        };
        break;
      }
    }
  }
  return result;
}
/** I retain the result before pipeline persistence so replay never repeats a provider call. */
export async function storeExtractionResult(
  deps: TawtheeqDependencies,
  input: ExtractionInput,
  result: z.infer<typeof extractionEnvelope>,
): Promise<void> {
  await withCompanyTx(deps.database, input, async (tx) => {
    await execute(
      tx,
      "update ops.idempotency_key set response=:response::jsonb where company_id=:company::uuid and account_id=:account::uuid and command_type=:command and key=:key",
      {
        company: input.companyId,
        account: input.accountId,
        key: input.idempotencyKey,
        command: input.commandType ?? "tawtheeq.extraction",
        response: JSON.stringify({ status: 200, body: result }),
      },
    );
  });
}
/** I persist the durable command result after its company lock is released; replay retries this idempotently. */
export async function persistExtraction(
  deps: TawtheeqDependencies,
  input: z.infer<typeof extractionEnvelope>,
): Promise<void> {
  if (!input.attempts.length) return;
  if (!deps.pipelineDatabase) throw new Refusal("UNAVAILABLE", null);
  await withSystemTx(
    deps.pipelineDatabase,
    { companyId: input.companyId },
    async (tx) => {
      // I serialize retries of this result without holding any lock during inference.
      await execute(
        tx,
        "select pg_advisory_xact_lock(hashtextextended(:key,0))",
        {
          key: `tawtheeq-extraction:${input.companyId}:${input.traceId}`,
        },
      );
      for (const attempt of input.attempts) {
        const exists = await rows(
          tx,
          "select id from ai.model_call where company_id=:company::uuid and id=:id::uuid",
          z.object({ id: z.uuid() }),
          { company: input.companyId, id: attempt.id },
        );
        if (exists.length) continue;
        const call = attempt.record;
        await execute(
          tx,
          "insert into ai.model_call(id,company_id,purpose,registry_entry,provider,model_id,prompt_version,input_sha256,output_sha256,latency_ms,tokens,cost_micro_usd,status) values (:id::uuid,:company::uuid,'tawtheeq_extraction',:entry,:provider,:model,:prompt,:input,:output,:latency::integer,:tokens::jsonb,:cost::bigint,:status)",
          {
            id: attempt.id,
            company: input.companyId,
            entry: attempt.entry,
            provider: call.provider,
            model: call.modelId,
            prompt: String(call.promptVersion),
            input: call.inputSha256,
            output: call.outputSha256,
            latency: call.latencyMs,
            tokens: JSON.stringify(call.usage),
            cost: call.costMicroUsd,
            status:
              call.status === "ok" && attempt.fields ? "succeeded" : "failed",
          },
        );
        const event = await writeAuditEvent(tx, input.companyId, {
          eventType: "model_call.created",
          actorAccountId: null,
          actorRole: null,
          initiator: "pipeline",
          channel: "system",
          subjectType: "model_call",
          subjectId: attempt.id,
          versionBefore: null,
          versionAfter: 1,
          traceId: input.traceId,
          registryEntry: attempt.entry,
          promptVersion: String(call.promptVersion),
        });
        await coverTransactionVersions(tx, input.companyId, event.eventId);
        if (attempt.fields && input.response.extractionId) {
          const fields = Object.fromEntries(
            Object.entries(attempt.fields).map(([key, value]) => [
              key,
              {
                value: value.value,
                confidence: value.value === null ? 0 : 1,
                page: 1,
                evidence:
                  value.value === null
                    ? value.nullReason
                    : (value.evidence ?? ""),
              },
            ]),
          );
          await execute(
            tx,
            "insert into ai.extraction(id,company_id,document_version_id,model_call_id,schema_code,fields) values (:id::uuid,:company::uuid,:document::uuid,:call::uuid,'tawtheeq_contract.v1',:fields::jsonb)",
            {
              id: input.response.extractionId,
              company: input.companyId,
              document: input.documentVersionId,
              call: attempt.id,
              fields: JSON.stringify(fields),
            },
          );
          const extractionEvent = await writeAuditEvent(tx, input.companyId, {
            eventType: "extraction.created",
            actorAccountId: null,
            actorRole: null,
            initiator: "pipeline",
            channel: "system",
            subjectType: "extraction",
            subjectId: input.response.extractionId,
            versionBefore: null,
            versionAfter: 1,
            traceId: input.traceId,
            modelCallIds: [attempt.id],
            registryEntry: attempt.entry,
          });
          await coverTransactionVersions(
            tx,
            input.companyId,
            extractionEvent.eventId,
          );
        }
      }
    },
  );
}
export const storedExtraction = z.object({
  id: z.uuid(),
  registry_entry: z.string(),
  fields: jsonValue.pipe(
    z.record(
      z.string(),
      z.object({
        value: z.string().nullable(),
        confidence: z.number(),
        page: z.number(),
        evidence: z.string(),
      }),
    ),
  ),
});
export function unpackFields(
  input: z.infer<typeof storedExtraction>,
): z.infer<typeof proposalsSchema> {
  return Object.fromEntries(
    Object.entries(input.fields).map(([key, field]) => [
      key,
      {
        value: field.value,
        evidence: field.value === null ? null : field.evidence,
        nullReason: field.value === null ? field.evidence : null,
      },
    ]),
  );
}
