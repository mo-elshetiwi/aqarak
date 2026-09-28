"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { verifyCsrfToken } from "@/lib/session/csrf";
import { getContractsApi } from "./contracts-api";
import {
  actionEnvelopeSchema,
  suggestionInputSchema,
  type SuggestionResult,
} from "./schemas";
const envelopeSchema = actionEnvelopeSchema.extend({
  contractId: z.uuid(),
  input: suggestionInputSchema,
});
export async function suggestClause(raw: unknown): Promise<SuggestionResult> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const e = parsed.data;
  await requireCompanyContext(e.locale, e.companyId);
  const session = await getCurrentSession();
  if (!session) redirect(`/${e.locale}/sign-in`);
  if (!verifyCsrfToken(session.sessionId, e.csrfToken))
    return { ok: false, code: "FORBIDDEN" };
  const result = await getContractsApi()
    .suggestClause(
      session.sessionId,
      e.companyId,
      e.contractId,
      e.input,
      e.idempotencyKey,
    )
    .catch(() => null);
  if (!result) return { ok: false, code: "MODEL_UNAVAILABLE" };
  if (!result.ok) {
    if (result.error.code === "SESSION_INVALID")
      redirect(`/${e.locale}/sign-in`);
    return { ok: false, code: result.error.code };
  }
  return result;
}
