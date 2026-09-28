import { randomUUID } from "node:crypto";
import { requestSha256 } from "@aqarak/domain";
import { z } from "zod";
import {
  audit,
  authorise,
  parameter,
  requireUnit,
  transaction,
  uuid,
  type Access,
  type RequestScope,
  type Transaction,
} from "./access";
import { intakeBodySchema } from "./contract";
import {
  claim,
  idempotencyKey,
  replay,
  storeResponse,
  type CommandResponse,
} from "./idempotency";
import { Problem, Denied } from "./problem";
import { jsonBody, parseInput, type Runtime } from "./runtime";
import { requireMedia, type MediaRow } from "../media/records";
import { draftReport, type Receipt } from "./intake-models";
import { draftRowSchema, intakeView, requireDraft } from "./intake-records";

type IntakeBody = z.infer<typeof intakeBodySchema>;
async function intakeMedia(
  tx: Transaction,
  access: Access,
  body: IntakeBody,
  lock = false,
): Promise<{ voice: MediaRow | null; photos: MediaRow[] }> {
  const media = new Map<string, MediaRow>();
  const ids = [
    ...body.photoMediaIds,
    ...(body.voiceMediaId ? [body.voiceMediaId] : []),
  ].sort();
  for (const id of ids) {
    const row = await requireMedia(tx, access, { id, completion: true, lock });
    if (row.unit_id !== body.unitId) throw new Denied("media", id);
    const field = id === body.voiceMediaId ? "voiceMediaId" : "photoMediaIds";
    if (row.drafted_action_id || row.ticket_id)
      throw new Problem(
        409,
        "MEDIA_IN_USE",
        "The media already belongs to a report.",
        { field },
      );
    if (
      row.processing_status !== "uploaded" ||
      !row.s3_version_id ||
      row.kind !== (field === "voiceMediaId" ? "voice_note" : "photo")
    )
      throw new Problem(
        409,
        "MEDIA_NOT_READY",
        "The media is not ready for this report.",
        { field },
      );
    media.set(id, row);
  }
  return {
    voice: body.voiceMediaId ? (media.get(body.voiceMediaId) ?? null) : null,
    photos: body.photoMediaIds.flatMap((id) => {
      const row = media.get(id);
      return row ? [row] : [];
    }),
  };
}
export async function unitVersion(
  tx: Transaction,
  unitId: string,
): Promise<number> {
  const row = (
    await tx.execute(
      "select version from estate.unit where company_id = :company and id = :unit for share",
      [uuid("company", tx.scope.companyId), uuid("unit", unitId)],
    )
  ).rows[0];
  return z.coerce.number().int().positive().parse(row?.version);
}
async function writeReceipt(
  tx: Transaction,
  draftId: string,
  receipt: Receipt,
): Promise<void> {
  const r = receipt.record;
  await tx.execute(
    `insert into maint.intake_model_call(id, company_id, created_by, drafted_action_id, media_id, class_id, candidate_id, provider, model_id, prompt_id, prompt_version, input_sha256, output_sha256, status, error_code, latency_ms, cost_micro_usd)
  values (:id, :company, :account, :draft, :media, :class, :candidate, :provider, :model, :prompt, :prompt_version, :input, :output, :status, :error, :latency, :cost)`,
    [
      uuid("id", receipt.id),
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      uuid("draft", draftId),
      parameter("media", receipt.mediaId, "UUID"),
      parameter("class", r.classId),
      parameter("candidate", r.candidateId),
      parameter("provider", r.provider),
      parameter("model", r.modelId),
      parameter("prompt", r.promptId),
      parameter("prompt_version", r.promptVersion),
      parameter("input", r.inputSha256),
      parameter("output", r.outputSha256),
      parameter("status", r.status),
      parameter("error", r.errorCode),
      parameter("latency", Math.round(r.latencyMs)),
      parameter("cost", r.costMicroUsd),
    ],
  );
}
export async function createIntake(
  runtime: Runtime,
  scope: RequestScope,
  request: Request,
): Promise<CommandResponse> {
  const keyValue = idempotencyKey(request);
  const raw = await jsonBody(request);
  const body = parseInput(intakeBodySchema, raw);
  if (
    !body.voiceMediaId &&
    !body.typedText?.trim() &&
    !body.photoMediaIds.length
  )
    throw new Problem(
      422,
      "INVALID_INPUT",
      "Provide text, a voice note or a photo.",
      { field: "report" },
    );
  if (new Set(body.photoMediaIds).size !== body.photoMediaIds.length)
    throw new Problem(422, "INVALID_INPUT", "Photos must be distinct.", {
      field: "photoMediaIds",
    });
  if (body.voiceMediaId && body.photoMediaIds.includes(body.voiceMediaId))
    throw new Problem(
      422,
      "INVALID_INPUT",
      "Voice and photo media must be different.",
      { field: "photoMediaIds" },
    );
  scope.channel = body.voiceMediaId ? "voice" : "mobile_form";
  const key = {
    key: keyValue,
    command: "maintenance.intake",
    hash: requestSha256({
      pathParams: { companyId: scope.companyId },
      body: z.json().parse(raw),
    }),
  };
  const preflight = await transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "write");
    const saved = await replay(tx, key);
    if (saved) return { saved, media: null, version: 0 };
    await requireUnit(tx, access, body.unitId);
    return {
      saved: null,
      media: await intakeMedia(tx, access, body),
      version: await unitVersion(tx, body.unitId),
    };
  });
  if (preflight.saved) return preflight.saved;
  const result = await draftReport(runtime.models(), runtime.storage(), {
    ...preflight.media,
    typedText: body.typedText,
    language: body.language,
  });
  return transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "write");
    const saved = await claim(tx, key);
    if (saved) return saved;
    await requireUnit(tx, access, body.unitId);
    const media = await intakeMedia(tx, access, body, true);
    const id = randomUUID();
    const row = draftRowSchema.parse(
      (
        await tx.execute(
          `insert into ai.drafted_action(id, company_id, created_by, for_account_id, initiator, channel, command_type, payload, base_versions, field_provenance, status)
    values (:id, :company, :account, :account, 'pipeline', :channel, 'ticket.report', :payload, :versions, '{}', 'ready') returning *`,
          [
            uuid("id", id),
            uuid("company", scope.companyId),
            uuid("account", tx.accountId),
            parameter("channel", scope.channel),
            parameter(
              "payload",
              JSON.stringify({ ...body, ...result.draft }),
              "JSON",
            ),
            parameter(
              "versions",
              JSON.stringify({ [`unit:${body.unitId}`]: preflight.version }),
              "JSON",
            ),
          ],
        )
      ).rows[0],
    );
    const covers = [];
    for (const item of [
      ...media.photos,
      ...(media.voice ? [media.voice] : []),
    ]) {
      await tx.execute(
        "update maint.media set drafted_action_id = :draft where company_id = :company and id = :id",
        [
          uuid("draft", id),
          uuid("company", scope.companyId),
          uuid("id", item.id),
        ],
      );
      covers.push({ type: "media", id: item.id, version: item.version + 1 });
    }
    for (const receipt of result.receipts) {
      await writeReceipt(tx, id, receipt);
      covers.push({ type: "intake_model_call", id: receipt.id, version: 1 });
    }
    await audit(tx, {
      event: "drafted_action.drafted",
      initiator: "pipeline",
      subjectType: "drafted_action",
      subjectId: id,
      versionAfter: 1,
      key: key.key,
      covers,
      modelCallIds: result.receipts.map((receipt) => receipt.id),
      promptVersion: "ticket-triage@1",
      registryEntry: result.registryEntry,
    });
    const intake = await intakeView(tx, row);
    const response = result.receipts.some(
      (receipt) => receipt.record.status === "timeout",
    )
      ? {
          status: 504,
          body: {
            type: "about:blank",
            title: "MODEL_TIMEOUT",
            status: 504,
            code: "MODEL_TIMEOUT",
            detail:
              "The model request timed out. The saved intake remains available for manual review.",
            intake,
          },
        }
      : { status: 201, body: { intake } };
    await storeResponse(tx, key, response);
    return response;
  });
}
export async function getIntake(
  runtime: Runtime,
  scope: RequestScope,
  intakeId: string | undefined,
): Promise<CommandResponse> {
  const id = parseInput(z.uuid(), intakeId);
  return transaction(runtime.db(), scope, async (tx) => {
    await authorise(tx, "read");
    const row = await requireDraft(tx, id);
    return { status: 200, body: { intake: await intakeView(tx, row) } };
  });
}
