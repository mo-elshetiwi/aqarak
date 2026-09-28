import { z } from "zod";
import type { Context } from "hono";
import { withCompanyTx } from "./database";
import {
  idempotencyKey,
  requestSha256,
  decideIdempotency,
  type CanonicalValue,
} from "./domain";
import {
  type AccountAuthenticator,
  type J3Dependencies,
  type RequestContext,
  loadActor,
} from "./context";
import { appendAuditEvent } from "./audit";
import { Problem, problemResponse } from "./problem";
import { rows, one, str, instant, jsonValue } from "./sql";

export interface Outcome {
  readonly status: number;
  readonly body: unknown;
  readonly afterCommit?: () => Promise<Outcome>;
  readonly refusal?: Problem;
}
export type Route<T> = {
  readonly schema: z.ZodType<T>;
  readonly run: (ctx: RequestContext, body: T) => Promise<Outcome>;
} & (
  | {
      readonly command: string;
      readonly authorize: (
        ctx: RequestContext,
        body: T,
      ) => void | Promise<void>;
    }
  | { readonly command?: never; readonly authorize?: never }
);
export const emptyBody = z.strictObject({});
export async function storeResponse(
  ctx: Pick<RequestContext, "tx" | "companyId" | "accountId" | "key">,
  command: string,
  outcome: Outcome,
): Promise<void> {
  await rows(
    ctx.tx,
    `update ops.idempotency_key set response=cast(:response as jsonb)
    where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and command_type=:command and key=:key`,
    {
      company: ctx.companyId,
      account: ctx.accountId,
      command,
      key: ctx.key,
      response: JSON.stringify({ status: outcome.status, body: outcome.body }),
    },
  );
}
async function reserve(
  ctx: RequestContext,
  command: string,
  body: CanonicalValue,
): Promise<Outcome | null> {
  const hash = requestSha256({ pathParams: ctx.params, body });
  const values = {
    company: ctx.companyId,
    account: ctx.accountId,
    command,
    key: ctx.key,
    hash,
  };
  const inserted = await rows(
    ctx.tx,
    `insert into ops.idempotency_key(company_id,account_id,command_type,key,request_sha256)
    values(cast(:company as uuid),cast(:account as uuid),:command,:key,:hash) on conflict do nothing returning key`,
    values,
  );
  if (inserted.length) return null;
  const stored = await one(
    ctx.tx,
    `select request_sha256,response,created_at from ops.idempotency_key
    where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and command_type=:command and key=:key`,
    { company: ctx.companyId, account: ctx.accountId, command, key: ctx.key },
  );
  if (str(stored, "request_sha256") !== hash)
    throw new Problem(422, "IDEMPOTENCY_KEY_REUSED");
  const decision = decideIdempotency({
    stored: {
      request_sha256: str(stored, "request_sha256"),
      response: z.json().nullable().parse(jsonValue(stored.response)),
      created_at: instant(stored.created_at),
    },
    requestSha256: hash,
    now: ctx.deps.now().toISOString(),
  });
  if (!decision.ok) throw new Problem(422, decision.error.code);
  if (decision.value.kind === "replay")
    return z
      .object({ status: z.number(), body: z.unknown() })
      .parse(decision.value.response);
  // An unfinished or retained command is never executed twice under a different transaction.
  throw new Problem(409, "INVALID_STATE");
}
function target(params: Readonly<Record<string, string>>): {
  subjectType: string;
  subjectId: string;
} {
  if (params.versionId)
    return { subjectType: "document_version", subjectId: params.versionId };
  if (params.tenantId)
    return { subjectType: "tenant", subjectId: params.tenantId };
  if (params.documentId)
    return { subjectType: "document", subjectId: params.documentId };
  return { subjectType: "company", subjectId: params.companyId ?? "" };
}
export async function recordDenial(
  deps: J3Dependencies,
  account: string,
  params: Readonly<Record<string, string>>,
  problem: Problem,
): Promise<void> {
  const company = params.companyId ?? "";
  try {
    await withCompanyTx(
      deps.appExecutor,
      { companyId: company, accountId: account },
      (tx) =>
        appendAuditEvent(tx, {
          companyId: company,
          accountId: account,
          type: "policy.denied",
          ...target(params),
          denialCode: problem.code,
        }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /audit_event_company_fk|foreign key constraint.*company/i.test(
        error.message,
      )
    )
      return;
    throw error;
  }
}
function parseParams(context: Context): Record<string, string> {
  const params = context.req.param();
  for (const [name, value] of Object.entries(params))
    if (name !== "fieldName" && !z.uuid().safeParse(value).success)
      throw new Problem(400, "VALIDATION_FAILED");
  return params;
}
async function parseBody<T>(
  context: Context,
  route: Route<T>,
): Promise<{ raw: CanonicalValue; body: T; key: string | null }> {
  const key = route.command
    ? idempotencyKey.safeParse(context.req.header("Idempotency-Key"))
    : null;
  if (key && !key.success) throw new Problem(400, "VALIDATION_FAILED");
  let raw: unknown = {};
  if (route.command) {
    try {
      raw = await context.req.json();
    } catch {
      throw new Problem(400, "VALIDATION_FAILED");
    }
  }
  const parsed = route.schema.safeParse(raw);
  if (!parsed.success) throw new Problem(400, "VALIDATION_FAILED");
  return {
    raw: z.json().parse(raw),
    body: parsed.data,
    key: key?.success ? key.data : null,
  };
}
export function routeHandler<T>(
  authenticate: AccountAuthenticator,
  resolve: () => J3Dependencies,
  route: Route<T>,
): (context: Context) => Promise<Response> {
  return async (context) => {
    let account: Awaited<ReturnType<AccountAuthenticator>>;
    try {
      account = await authenticate(context.req.raw);
    } catch {
      return problemResponse(new Problem(503, "UNAVAILABLE"));
    }
    if (!account) return problemResponse(new Problem(401, "SESSION_INVALID"));
    let params: Record<string, string> = {};
    let deps: J3Dependencies | undefined;
    try {
      params = parseParams(context);
      const company = params.companyId;
      if (!company) throw new Problem(400, "VALIDATION_FAILED");
      const input = await parseBody(context, route);
      deps = resolve();
      const current = deps;
      const transactionResult = await withCompanyTx(
        current.appExecutor,
        { companyId: company, accountId: account.accountId },
        async (tx) => {
          const actor = await loadActor(tx, company, account.accountId);
          const ctx: RequestContext = {
            tx,
            deps: current,
            companyId: company,
            accountId: account.accountId,
            actor,
            params,
            key: input.key,
          };
          if (route.command) {
            await route.authorize(ctx, input.body);
            const replay = await reserve(ctx, route.command, input.raw);
            if (replay) {
              return { outcome: replay, replayed: true };
            }
          }
          const result = await route.run(ctx, input.body);
          if (route.command) await storeResponse(ctx, route.command, result);
          return { outcome: result, replayed: false };
        },
      );
      const replayed = transactionResult.replayed;
      let outcome = transactionResult.outcome;
      if (outcome.afterCommit) outcome = await outcome.afterCommit();
      if (outcome.refusal) {
        await recordDenial(current, account.accountId, params, outcome.refusal);
        return problemResponse(outcome.refusal);
      }
      if (outcome.status >= 400) {
        const storedProblem = z
          .object({ status: z.number(), code: z.string() })
          .parse(outcome.body);
        const refusal = new Problem(storedProblem.status, storedProblem.code);
        await recordDenial(current, account.accountId, params, refusal);
        const response = problemResponse(refusal);
        if (replayed) response.headers.set("Idempotent-Replayed", "true");
        return response;
      }
      return new Response(JSON.stringify(outcome.body), {
        status: outcome.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...(replayed ? { "Idempotent-Replayed": "true" } : {}),
        },
      });
    } catch (error) {
      const problem =
        error instanceof Problem ? error : new Problem(503, "UNAVAILABLE");
      if (
        deps &&
        params.companyId &&
        [403, 404, 409, 422].includes(problem.status)
      ) {
        try {
          await recordDenial(deps, account.accountId, params, problem);
        } catch {
          return problemResponse(new Problem(503, "UNAVAILABLE"));
        }
      }
      return problemResponse(problem);
    }
  };
}
