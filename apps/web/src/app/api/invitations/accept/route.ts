import { ok } from "@aqarak/domain";
import { authHandler } from "@/lib/auth/handler";
import {
  tokenInputSchema,
  localeSchema,
  idempotencyKeySchema,
} from "@/lib/api/contract";
export const POST = authHandler({
  schema: tokenInputSchema.extend({
    locale: localeSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
  authenticated: true,
  run: async (api, input, context) => {
    const result = await api.acceptInvitation(
      context.sessionId,
      input.token,
      input.idempotencyKey,
    );
    return result.ok
      ? ok({
          body: {
            redirectTo: `/${input.locale}/companies/${result.value.context.companyId}/home`,
          },
        })
      : result;
  },
});
