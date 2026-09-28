import type { CompanyTransaction } from "@aqarak/db";
import { z } from "zod";
import { createInvitation } from "./invitations";
export async function queuePartyInvitation(input: {
  tx: CompanyTransaction;
  companyId: string;
  accountId: string;
  kind: "owner" | "tenant";
  targetId: string;
  email: string;
  locale: "en" | "ar";
  now: () => Date;
}): Promise<{ id: string; status: "pending"; expiresAt: string }> {
  const response = await createInvitation(
    {
      tx: input.tx,
      companyId: input.companyId,
      principal: { accountId: input.accountId, client: "web" },
      deps: { clock: input.now },
      role: "manager",
      key: undefined,
      permission: {
        route: `/v1/companies/:companyId/${input.kind}s/:id/invitation`,
        method: "POST",
        capability: "party_links",
        operation: "write",
      },
      input: {
        kind: input.kind,
        targetId: input.targetId,
        email: input.email.toLowerCase(),
        locale: input.locale,
      },
    },
    true,
  );
  return z
    .object({
      invitation: z.object({
        id: z.uuid(),
        status: z.literal("pending"),
        expiresAt: z.iso.datetime(),
      }),
    })
    .parse(response.body).invitation;
}
