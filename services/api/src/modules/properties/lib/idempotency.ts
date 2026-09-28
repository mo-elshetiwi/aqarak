import type { CompanyTransaction } from "./db.mjs";
import { requestSha256, type CanonicalValue } from "./domain";
import { z } from "zod";
import type { AuditContext } from "./audit";
import { rows, uuid, param, json } from "./sql";
import { fail } from "./problem";
export interface CommandResponse {
  status: 200 | 201;
  body: Record<string, unknown>;
}
const storedResponse = z.object({
  status: z.union([z.literal(200), z.literal(201)]),
  body: z.record(z.string(), z.unknown()),
});
export async function idempotent(
  tx: CompanyTransaction,
  context: AuditContext,
  request: {
    command: string;
    pathParams: Record<string, string>;
    body: CanonicalValue;
  },
  execute: () => Promise<CommandResponse>,
): Promise<CommandResponse> {
  const hash = requestSha256(request);
  const params = [
    uuid("c", context.companyId),
    uuid("a", context.accountId),
    param("command", request.command),
    param("key", context.key),
    param("hash", hash),
  ];
  const inserted = await rows(
    tx,
    `insert into ops.idempotency_key(company_id,account_id,command_type,key,request_sha256) values (:c,:a,:command,:key,:hash) on conflict do nothing returning key`,
    params,
  );
  if (!inserted.length) {
    const old = (
      await rows(
        tx,
        "select request_sha256,response from ops.idempotency_key where company_id=:c and account_id=:a and command_type=:command and key=:key",
        params,
      )
    )[0];
    if (old?.request_sha256 !== hash || old.response == null)
      fail(422, "IDEMPOTENCY_KEY_REUSED");
    return storedResponse.parse(
      typeof old.response === "string"
        ? JSON.parse(old.response)
        : old.response,
    );
  }
  const response = await execute();
  await tx.execute(
    "update ops.idempotency_key set response=:response where company_id=:c and account_id=:a and command_type=:command and key=:key",
    [...params, json("response", response)],
  );
  return response;
}
