import type { Context } from "hono";
import { authenticateRequest } from "../../identity/adapters";
export type IdentityResolver = (
  context: Context,
) => Promise<{ accountId: string } | null>;
export const resolveIdentity: IdentityResolver = (context) =>
  authenticateRequest(context.req.raw);
