"use server";
import type { Result } from "@aqarak/domain";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { verifyCsrfToken } from "@/lib/session/csrf";
import { getContractsApi, type ContractsApi } from "./contracts-api";
import {
  actionEnvelopeSchema,
  decisionInputSchema,
  draftInputSchema,
  editInputSchema,
  reasonInputSchema,
  versionInputSchema,
  type ActionEnvelope,
  type ActionResult,
  type ContractDetail,
  type Problem,
} from "./schemas";

type Invoke<T> = (context: {
  api: ContractsApi;
  sessionId: string;
  envelope: ActionEnvelope;
  input: T;
}) => Promise<Result<ContractDetail, Problem>>;
async function run<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  invoke: Invoke<T>,
): Promise<ActionResult> {
  const envelope = actionEnvelopeSchema.safeParse(raw);
  if (!envelope.success)
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      field: envelope.error.issues[0]?.path.join(".") ?? "input",
    };
  const data = envelope.data;
  await requireCompanyContext(data.locale, data.companyId);
  const session = await getCurrentSession();
  if (!session) redirect(`/${data.locale}/sign-in`);
  if (!verifyCsrfToken(session.sessionId, data.csrfToken))
    return { ok: false, code: "FORBIDDEN" };
  const input = schema.safeParse(data.input);
  if (!input.success)
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      field: input.error.issues[0]?.path.join(".") ?? "input",
    };
  let result: Result<ContractDetail, Problem>;
  try {
    result = await invoke({
      api: getContractsApi(),
      sessionId: session.sessionId,
      envelope: data,
      input: input.data,
    });
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
  if (!result.ok) {
    if (result.error.code === "SESSION_INVALID")
      redirect(`/${data.locale}/sign-in`);
    return {
      ok: false,
      code: result.error.code,
      ...(result.error.field ? { field: result.error.field } : {}),
    };
  }
  revalidatePath(`/${data.locale}/companies/${data.companyId}/contracts`);
  return { ok: true, contractId: result.value.contract.id };
}
const existing = actionEnvelopeSchema.extend({ contractId: z.uuid() });
async function runExisting<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  invoke: Invoke<T>,
): Promise<ActionResult> {
  if (!existing.safeParse(raw).success)
    return { ok: false, code: "VALIDATION_FAILED" };
  return run(raw, schema, invoke);
}
export async function createContract(raw: unknown): Promise<ActionResult> {
  return run(raw, draftInputSchema, ({ api, sessionId, envelope: e, input }) =>
    api.create(sessionId, e.companyId, input, e.idempotencyKey),
  );
}
export async function editContract(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    editInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.edit(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function submitContract(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    versionInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.submit(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function approveOwner(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    decisionInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.approveOwner(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function returnOwner(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    reasonInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.returnOwner(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function acceptTenant(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    decisionInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.acceptTenant(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function returnTenant(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    reasonInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.returnTenant(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function withdrawContract(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    reasonInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.withdraw(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function cancelContract(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    reasonInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.cancel(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
export async function reviseContract(raw: unknown): Promise<ActionResult> {
  return runExisting(
    raw,
    versionInputSchema,
    ({ api, sessionId, envelope: e, input }) =>
      api.revise(
        sessionId,
        e.companyId,
        e.contractId ?? "",
        input,
        e.idempotencyKey,
      ),
  );
}
