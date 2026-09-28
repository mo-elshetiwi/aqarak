import { z } from "zod";
import { err, ok } from "@aqarak/domain";
import type { NextRequest, NextResponse } from "next/server";
import { authHandler } from "@/lib/auth/handler";
import {
  reasonCommandSchema,
  localeSchema,
  idempotencyKeySchema,
} from "@/lib/api/contract";

const schema = reasonCommandSchema.extend({
  locale: localeSchema,
  idempotencyKey: idempotencyKeySchema,
});
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string; invitationId: string }> },
): Promise<NextResponse> {
  const { companyId, invitationId } = await params;
  return authHandler({
    schema,
    authenticated: true,
    run: async (api, input, context) => {
      if (
        !z.uuid().safeParse(companyId).success ||
        !z.uuid().safeParse(invitationId).success
      )
        return err({ status: 404, code: "NOT_FOUND" });
      const result = await api.revokeInvitation(
        context.sessionId,
        companyId,
        invitationId,
        reasonCommandSchema.parse(input),
        input.idempotencyKey,
      );
      if (!result.ok) return result;
      return ok({ body: { ok: true as const } });
    },
  })(request);
}
