"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  getCurrentSession,
  requireCompanyContext,
} from "@/lib/session/session";
import { verifyCsrfToken } from "@/lib/session/csrf";
import { getContractsApi } from "../../contracts/_lib/contracts-api";
import {
  actionEnvelopeSchema,
  type ProblemCode,
} from "../../contracts/_lib/schemas";
const envelopeSchema = actionEnvelopeSchema.omit({ contractId: true }).extend({
  input: z.strictObject({ notificationId: z.uuid() }),
});
export async function markRead(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; code: ProblemCode }> {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "VALIDATION_FAILED" };
  const e = parsed.data;
  await requireCompanyContext(e.locale, e.companyId);
  const session = await getCurrentSession();
  if (!session) redirect(`/${e.locale}/sign-in`);
  if (!verifyCsrfToken(session.sessionId, e.csrfToken))
    return { ok: false, code: "FORBIDDEN" };
  const result = await getContractsApi()
    .markNotificationRead(
      session.sessionId,
      e.companyId,
      e.input.notificationId,
      e.idempotencyKey,
    )
    .catch(() => null);
  if (!result) return { ok: false, code: "UNAVAILABLE" };
  if (!result.ok) {
    if (result.error.code === "SESSION_INVALID")
      redirect(`/${e.locale}/sign-in`);
    return { ok: false, code: result.error.code };
  }
  revalidatePath(`/${e.locale}/companies/${e.companyId}/approvals`);
  return { ok: true };
}
