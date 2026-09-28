"use server";
import type { CompanyContext } from "@/lib/api/contract";
import { z } from "zod";
import { getCurrentSession } from "@/lib/session/session";
import { verifyCsrfToken } from "@/lib/session/csrf";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { getTawtheeqClient, type TawtheeqClient } from "../_lib/client";
import {
  ownerDecisionSchema,
  ownerReapprovalSchema,
  expectedSchema,
  reasonInputSchema,
  resolutionsInputSchema,
  reviewInputSchema,
  skipInputSchema,
  uploadInputSchema,
  type DocumentUrl,
  type Extraction,
  type TawtheeqRecord,
  type UploadResult,
  type WorkflowResult,
} from "../_lib/schemas";
const envelope = z.object({
  companyId: z.uuid(),
  recordId: z.uuid(),
  idempotencyKey: z.uuid(),
});
const commandSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("ownerReapproval"),
    input: ownerReapprovalSchema,
  }),
  z.object({
    command: z.literal("skipConfirmation"),
    input: ownerDecisionSchema,
  }),
  z.object({ command: z.literal("attestPortal"), input: expectedSchema }),
  z.object({ command: z.literal("requestUpload"), input: uploadInputSchema }),
  z.object({
    command: z.literal("completeUpload"),
    input: expectedSchema.extend({ documentVersionId: z.uuid() }),
  }),
  z.object({ command: z.literal("runExtraction"), input: z.object({}) }),
  z.object({ command: z.literal("submitReview"), input: reviewInputSchema }),
  z.object({
    command: z.literal("submitResolutions"),
    input: resolutionsInputSchema,
  }),
  z.object({ command: z.literal("portalReturn"), input: reasonInputSchema }),
  z.object({ command: z.literal("skip"), input: skipInputSchema }),
  z.object({ command: z.literal("resume"), input: expectedSchema }),
  z.object({ command: z.literal("getDocumentUrl"), input: z.object({}) }),
]);
export type ActionCommand = z.infer<typeof commandSchema>;
export interface ActionFailure {
  ok: false;
  code: string;
  domainCode?: string;
  fieldErrors: Record<string, string[]>;
}
export type ActionResult =
  | {
      ok: true;
      record: TawtheeqRecord;
      upload?: UploadResult;
      extraction?: Extraction;
      documentUrl?: DocumentUrl;
    }
  | ActionFailure;
function failed(
  code: string,
  fieldErrors: Record<string, string[]> = {},
  domainCode?: string,
): ActionFailure {
  return {
    ok: false,
    code,
    fieldErrors,
    ...(domainCode ? { domainCode } : {}),
  };
}
async function execute(
  client: TawtheeqClient,
  id: string,
  key: string,
  action: ActionCommand,
): Promise<
  WorkflowResult<TawtheeqRecord | UploadResult | Extraction | DocumentUrl>
> {
  switch (action.command) {
    case "ownerReapproval":
      return client.ownerReapproval(id, action.input, key);
    case "skipConfirmation":
      return client.skipConfirmation(id, action.input, key);
    case "completeUpload":
      return client.completeUpload(
        id,
        action.input.documentVersionId,
        { expectedVersion: action.input.expectedVersion },
        key,
      );
    case "runExtraction":
      return client.runExtraction(id, key);
    case "getDocumentUrl":
      return client.getDocumentUrl(id);
    case "requestUpload":
      return client.requestUpload(id, action.input, key);
    case "attestPortal":
      return client.attestPortal(id, action.input, key);
    case "submitReview":
      return client.submitReview(id, action.input, key);
    case "submitResolutions":
      return client.submitResolutions(id, action.input, key);
    case "portalReturn":
      return client.portalReturn(id, action.input, key);
    case "skip":
      return client.skip(id, action.input, key);
    case "resume":
      return client.resume(id, action.input, key);
  }
}
export async function tawtheeqAction(raw: unknown): Promise<ActionResult> {
  try {
    const session = await getCurrentSession();
    if (!session) return failed("SESSION_INVALID");
    const token = csrfFrom(raw);
    if (!verifyCsrfToken(session.sessionId, token))
      return failed("CSRF_INVALID");
    const parsed = envelope.and(commandSchema).safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues)
        errors[issue.path.join(".")] = ["INVALID_INPUT"];
      return failed("VALIDATION_FAILED", errors);
    }
    const input = parsed.data;
    const context = session.me.contexts.find(
      (c) => c.companyId === input.companyId,
    );
    const ownerCommand =
      input.command === "ownerReapproval" ||
      input.command === "skipConfirmation";
    if (!context || !commandPermitted(context, ownerCommand))
      return failed("NOT_PERMITTED");
    const client = ownerCommand
      ? getTawtheeqClient(input.companyId, session.sessionId, context)
      : getTawtheeqClient(input.companyId, session.sessionId);
    if (ownerCommand) {
      const refusal = await ownerRefusal(client, input.recordId, context);
      if (refusal) return refusal;
    }
    const result = await execute(
      client,
      input.recordId,
      input.idempotencyKey,
      input,
    );
    if (!result.ok)
      return failed(result.error.code, {}, result.error.domainCode);
    return await assembleResult(client, input.recordId, result.value);
  } catch {
    return failed("UNAVAILABLE");
  }
}

async function assembleResult(
  client: TawtheeqClient,
  recordId: string,
  value: TawtheeqRecord | UploadResult | Extraction | DocumentUrl,
): Promise<ActionResult> {
  if ("workflowState" in value) return { ok: true, record: value };
  const fresh = await client.getRecord(recordId);
  if (!fresh.ok) return failed(fresh.error.code, {}, fresh.error.domainCode);
  if ("upload" in value)
    return { ok: true, record: fresh.value, upload: value };
  if ("fields" in value)
    return { ok: true, record: fresh.value, extraction: value };
  return { ok: true, record: fresh.value, documentUrl: value };
}

function commandPermitted(context: CompanyContext, owner: boolean): boolean {
  return owner
    ? context.partyLinks.some((link) => link.role === "owner")
    : isSectionPermitted(context, "tawtheeq");
}
async function ownerRefusal(
  client: TawtheeqClient,
  recordId: string,
  context: CompanyContext,
): Promise<ActionFailure | null> {
  const current = await client.getRecord(recordId);
  if (!current.ok) return failed(current.error.code);
  return context.partyLinks.some(
    (link) =>
      link.role === "owner" &&
      link.partyId === current.value.contract.owner.partyId,
  )
    ? null
    : failed("NOT_PERMITTED");
}

function csrfFrom(raw: unknown): unknown {
  return typeof raw === "object" && raw !== null && "csrfToken" in raw
    ? raw.csrfToken
    : undefined;
}
