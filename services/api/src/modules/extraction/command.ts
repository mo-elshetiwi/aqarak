import { getConfig } from "../../config";
import { randomUUID } from "node:crypto";
import { withSystemTx, type Row } from "../documents/database";
import { sniffContentType } from "../documents/domain";
import {
  DOCUMENT_EXTRACTION_PROMPT,
  documentExtractionSchemaFor,
  getCandidate,
  type ModelImage,
} from "../../models";
import type { RequestContext } from "../documents/context";
import { Problem } from "../documents/problem";
import { loadVersion, versionDetail } from "../documents/read";
import { boundObject, scanGate, transition } from "../documents/commands";
import { appendAuditEvent } from "../documents/audit";
import { one, rows, str, num } from "../documents/sql";
import { storeResponse, type Outcome } from "../documents/http";
import { mapFields } from "./fields";

export async function runExtraction(
  ctx: RequestContext,
  row: Row,
  image: ModelImage,
): Promise<Outcome> {
  const extraction = ctx.deps.extraction;
  const pipeline = ctx.deps.pipelineExecutor;
  if (!extraction || !pipeline)
    throw new Problem(503, "EXTRACTION_UNAVAILABLE");
  const classId = "mc1_document_extraction";
  const candidateId = extraction.registry.classes[classId].primary;
  const candidate = getCandidate(extraction.registry, classId, candidateId);
  const prompt = DOCUMENT_EXTRACTION_PROMPT;
  const timeoutMs = getConfig().EXTRACTION_TIMEOUT_MS;
  const result = await extraction.gateway.generateStructured({
    classId,
    candidateId,
    promptId: prompt.id,
    promptVersion: prompt.version,
    instructions: prompt.instructions,
    userText: prompt.userTextFor("emirates_id"),
    images: [image],
    schemaId: "emirates_id_extraction",
    schema: documentExtractionSchemaFor("emirates_id"),
    timeoutMs: timeoutMs,
  });
  const callId = randomUUID();
  const key = `${str(row, "s3_key").replace(/original$/, "")}receipts/${callId}.json`;
  await ctx.deps.storage.putReceipt(
    { bucket: str(row, "bucket"), key },
    {
      record: result.record,
      rawText: result.rawText,
      nullReasons: result.output
        ? Object.fromEntries(
            Object.entries(result.output.fields).map(([name, field]) => [
              name,
              field.null_reason,
            ]),
          )
        : {},
    },
  );
  return withSystemTx(pipeline, { companyId: ctx.companyId }, async (tx) => {
    const current = await one(
      tx,
      `select * from doc.document_version where company_id=cast(:company as uuid) and id=cast(:id as uuid) for update`,
      { company: ctx.companyId, id: str(row, "id") },
    );
    if (current.processing_status !== "extracting")
      throw new Problem(409, "INVALID_STATE");
    const succeeded = result.record.status === "ok" && result.output !== null;
    const record = result.record;
    const registryEntry = `${classId}/${candidateId}`;
    const promptVersion = `${prompt.id}@${String(prompt.version)}`;
    const model = await one(
      tx,
      `insert into ai.model_call(id,company_id,purpose,registry_entry,provider,model_id,prompt_version,input_sha256,output_sha256,output_key,latency_ms,tokens,cost_micro_usd,status)
      values(cast(:id as uuid),cast(:company as uuid),:purpose,:registry,:provider,:model,:prompt,:input,:output,:key,:latency,cast(:tokens as jsonb),:cost,:status) returning version`,
      {
        id: callId,
        company: ctx.companyId,
        purpose: classId,
        registry: registryEntry,
        provider: candidate.provider,
        model: candidate.modelId,
        prompt: promptVersion,
        input: record.inputSha256,
        output: record.outputSha256,
        key,
        latency: Math.round(record.latencyMs),
        tokens: JSON.stringify({
          input: record.usage.inputTokens,
          output: record.usage.outputTokens,
          reasoning: record.usage.reasoningTokens,
        }),
        cost: record.costMicroUsd,
        status: succeeded ? "succeeded" : "failed",
      },
    );
    const updated = await one(
      tx,
      `update doc.document_version set processing_status=:status where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning version`,
      {
        company: ctx.companyId,
        id: str(row, "id"),
        status: succeeded ? "extracted" : "extraction_failed",
      },
    );
    const event = {
      companyId: ctx.companyId,
      accountId: null,
      initiator: "pipeline" as const,
      modelCallIds: [callId],
      registryEntry,
      promptVersion,
    };
    const versionSubject = {
      type: "document_version",
      id: str(row, "id"),
      version: num(updated, "version"),
    };
    if (succeeded) {
      const extracted = await one(
        tx,
        `insert into ai.extraction(company_id,document_version_id,model_call_id,schema_code,fields)
        values(cast(:company as uuid),cast(:version as uuid),cast(:call as uuid),'emirates_id@1',cast(:fields as jsonb)) returning id,version`,
        {
          company: ctx.companyId,
          version: str(row, "id"),
          call: callId,
          fields: JSON.stringify(mapFields(result.output)),
        },
      );
      await appendAuditEvent(
        tx,
        {
          ...event,
          type: "extraction.created",
          subjectType: "extraction",
          subjectId: str(extracted, "id"),
          versionAfter: num(extracted, "version"),
        },
        [
          { type: "model_call", id: callId, version: num(model, "version") },
          versionSubject,
        ],
      );
    } else {
      await appendAuditEvent(
        tx,
        {
          ...event,
          type: "model_call.created",
          subjectType: "model_call",
          subjectId: callId,
          versionAfter: num(model, "version"),
        },
        [versionSubject],
      );
    }
    const outcome =
      result.record.status === "timeout"
        ? { status: 504, body: new Problem(504, "EXTRACTION_TIMEOUT").body() }
        : {
            status: 200,
            body: {
              version: await versionDetail(
                { tx, companyId: ctx.companyId },
                str(row, "id"),
              ),
            },
          };
    await storeResponse(
      { tx, companyId: ctx.companyId, accountId: ctx.accountId, key: ctx.key },
      "document.extraction",
      outcome,
    );
    return outcome;
  });
}
export async function extractDocument(ctx: RequestContext): Promise<Outcome> {
  let row = await loadVersion(ctx, "write");
  if (row.doc_type !== "emirates_id")
    throw new Problem(422, "UNSUPPORTED_FOR_EXTRACTION");
  if (row.review_status !== "pending_review")
    throw new Problem(409, "INVALID_STATE");
  row = await scanGate(ctx, row);
  if (row.processing_status === "scan_rejected")
    return {
      status: 409,
      body: new Problem(409, "SCAN_REJECTED").body(),
      refusal: new Problem(409, "SCAN_REJECTED"),
    };
  if (
    !["scan_clean", "extraction_failed"].includes(str(row, "processing_status"))
  )
    throw new Problem(409, "INVALID_STATE");
  if (row.content_type === "application/pdf") {
    await transition(ctx, row, {
      status: "extraction_failed",
      event: "document_version.extracting",
      reason: "unsupported_for_extraction",
    });
    const problem = new Problem(422, "UNSUPPORTED_FOR_EXTRACTION");
    return { status: 422, body: problem.body(), refusal: problem };
  }
  if (!ctx.deps.pipelineExecutor || !ctx.deps.extraction) {
    await transition(ctx, row, {
      status: "extraction_failed",
      event: "document_version.extracting",
      reason: "provider_unavailable",
    });
    return {
      status: 503,
      body: new Problem(503, "EXTRACTION_UNAVAILABLE").body(),
    };
  }
  const decisions = await rows(
    ctx.tx,
    `select id from doc.field_review where company_id=cast(:company as uuid) and document_version_id=cast(:id as uuid) limit 1`,
    { company: ctx.companyId, id: str(row, "id") },
  );
  if (decisions.length) throw new Problem(409, "INVALID_STATE");
  const bytes = await ctx.deps.storage.getBytes(boundObject(row));
  const mediaType = sniffContentType(bytes);
  if (
    (mediaType !== "image/jpeg" && mediaType !== "image/png") ||
    mediaType !== row.content_type
  )
    throw new Problem(422, "UNSUPPORTED_TYPE");
  row = await transition(ctx, row, {
    status: "extracting",
    event: "document_version.extracting",
  });
  const started = row;
  return {
    status: 200,
    body: { version: await versionDetail(ctx, str(row, "id")) },
    afterCommit: () => runExtraction(ctx, started, { bytes, mediaType }),
  };
}
