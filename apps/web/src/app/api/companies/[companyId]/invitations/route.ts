import { z } from "zod";
import { err, ok } from "@aqarak/domain";
import type { NextRequest, NextResponse } from "next/server";
import { authHandler } from "@/lib/auth/handler";
import {
  createInvitationSchema,
  invitationLinkSchema,
} from "@/lib/auth/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  const { companyId } = await params;
  return authHandler<
    z.infer<typeof createInvitationSchema>,
    z.infer<typeof invitationLinkSchema>
  >({
    schema: createInvitationSchema,
    authenticated: true,
    run: async (api, input, context) => {
      if (!z.uuid().safeParse(companyId).success || !context.origin)
        return err({ status: 404, code: "NOT_FOUND" });
      const result = await api.createInvitation(
        context.sessionId,
        companyId,
        {
          kind: "staff",
          email: input.email,
          staffRoles: input.staffRoles,
          locale: input.inviteLocale,
        },
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
