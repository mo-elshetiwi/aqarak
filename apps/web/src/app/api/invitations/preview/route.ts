import { ok } from "@aqarak/domain";
import { authHandler } from "@/lib/auth/handler";
import { tokenInputSchema, type InvitationPreview } from "@/lib/api/contract";
export const POST = authHandler<{ token: string }, InvitationPreview>({
  schema: tokenInputSchema,
  run: async (api, input) => {
    const result = await api.previewInvitation(input.token);
    return result.ok ? ok({ body: result.value }) : result;
  },
});
