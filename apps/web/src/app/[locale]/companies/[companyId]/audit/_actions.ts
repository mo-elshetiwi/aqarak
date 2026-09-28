"use server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/session/session";
import { verifyCsrfToken } from "@/lib/session/csrf";
import { canReadAudit, getAuditClient } from "./_lib/client";
import {
  eventFiltersSchema,
  unavailable,
  type Anchor,
  type AuditResult,
  type Events,
  type Verification,
} from "./_lib/schemas";
const envelope = z.object({
  companyId: z.uuid(),
  csrfToken: z.string(),
  idempotencyKey: z.uuid(),
});
const command = z.discriminatedUnion("command", [
  z.object({ command: z.literal("events"), filters: eventFiltersSchema }),
  z.object({ command: z.literal("verify") }),
  z.object({ command: z.literal("anchor") }),
]);
export type AuditActionResult = AuditResult<Events | Verification | Anchor>;
export async function auditAction(raw: unknown): Promise<AuditActionResult> {
  try {
    const session = await getCurrentSession();
    if (!session)
      return { ok: false, error: { status: 401, code: "SESSION_INVALID" } };
    const parsed = envelope.and(command).safeParse(raw);
    if (!parsed.success)
      return { ok: false, error: { status: 422, code: "VALIDATION_FAILED" } };
    const input = parsed.data;
    if (!verifyCsrfToken(session.sessionId, input.csrfToken))
      return { ok: false, error: { status: 403, code: "CSRF_INVALID" } };
    const context = session.me.contexts.find(
      (c) => c.companyId === input.companyId,
    );
    if (!context || !canReadAudit(context))
      return { ok: false, error: { status: 403, code: "NOT_PERMITTED" } };
    const client = getAuditClient(input.companyId, session.sessionId);
    switch (input.command) {
      case "events":
        return await client.events(input.filters);
      case "verify":
        return await client.verify(input.idempotencyKey);
      case "anchor":
        return await client.anchor(input.idempotencyKey);
    }
  } catch {
    return unavailable;
  }
}
