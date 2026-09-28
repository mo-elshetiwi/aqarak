import {
  decideIdempotency,
  requestSha256,
  storedIdempotency,
  type CanonicalValue,
} from "./domain";
import type { CompanyTransaction } from "./db";
import { z } from "zod";
import { first, parameters, instant } from "./sql";
import { WorkflowProblem } from "./problem";
import type { AuditActor } from "./audit";
export interface StoredResponse {
  status: number;
  body: CanonicalValue;
}
export interface ReplayInput {
  actor: AuditActor;
  command: string;
  pathParams: Record<string, string>;
  body: CanonicalValue;
  now: string;
}
export async function claimIdempotency(
  tx: CompanyTransaction,
  input: ReplayInput,
): Promise<StoredResponse | null> {
  const hash = requestSha256({
    pathParams: input.pathParams,
    body: input.body,
  });
  const values = {
    company: input.actor.companyId,
    account: input.actor.accountId,
    command: input.command,
    key: input.actor.key,
    hash,
  };
  const inserted = await first(
    tx,
    `insert into ops.idempotency_key(company_id,account_id,command_type,key,request_sha256)
    values (:company::uuid,:account::uuid,:command,:key,:hash) on conflict do nothing returning request_sha256`,
    values,
  );
  if (inserted) return null;
  const row = await first(
    tx,
    `select request_sha256,response,created_at from ops.idempotency_key
    where company_id=:company::uuid and account_id=:account::uuid and command_type=:command and key=:key`,
    values,
  );
  if (!row) throw new WorkflowProblem("UNAVAILABLE");
  const stored = storedIdempotency.parse({
    ...row,
    response:
      typeof row.response === "string"
        ? (JSON.parse(row.response) as unknown)
        : row.response,
    created_at: instant(row.created_at),
  });
  if (stored.request_sha256 !== hash)
    throw new WorkflowProblem("IDEMPOTENCY_KEY_REUSED");
  const decision = decideIdempotency({
    stored,
    requestSha256: hash,
    now: input.now,
  });
  if (!decision.ok) throw new WorkflowProblem(decision.error.code);
  const response =
    decision.value.kind === "replay"
      ? decision.value.response
      : stored.response;
  if (response === null) throw new WorkflowProblem("UNAVAILABLE");
  return z
    .object({
      status: z.number().int().min(200).max(299),
      body: z.custom<CanonicalValue>((value: unknown) => value !== undefined),
    })
    .parse(response);
}
export async function completeIdempotency(
  tx: CompanyTransaction,
  input: { actor: AuditActor; command: string; response: StoredResponse },
): Promise<void> {
  await tx.execute(
    `update ops.idempotency_key set response=:response::jsonb where company_id=:company::uuid and account_id=:account::uuid and command_type=:command and key=:key`,
    parameters({
      company: input.actor.companyId,
      account: input.actor.accountId,
      command: input.command,
      key: input.actor.key,
      response: JSON.stringify(input.response),
    }),
  );
}
