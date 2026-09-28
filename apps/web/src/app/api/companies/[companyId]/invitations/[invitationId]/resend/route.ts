import { z } from "zod";
import { err, ok } from "@aqarak/domain";
import type { NextRequest, NextResponse } from "next/server";
import { authHandler } from "@/lib/auth/handler";
import {
  versionCommandSchema,
  localeSchema,
  idempotencyKeySchema,
} from "@/lib/api/contract";
import { invitationLinkSchema } from "@/lib/auth/schemas";

const schema = versionCommandSchema.extend({
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
        !context.origin ||
        !z.uuid().safeParse(companyId).success ||
        !z.uuid().safeParse(invitationId).success
      )
        return err({ status: 404, code: "NOT_FOUND" });
      const result = await api.resendInvitation(
        context.sessionId,
        companyId,
        invitationId,
        versionCommandSchema.parse(input),
        input.idempotencyKey,
      );
      if (!result.ok) return result;
      return ok({
        body: invitationLinkSchema.parse({
          invitation: result.value.invitation,
          inviteUrl: result.value.acceptPath
            ? `${context.origin}${result.value.acceptPath}`
            : null,
        }),
      });
    },
  })(request);
}
