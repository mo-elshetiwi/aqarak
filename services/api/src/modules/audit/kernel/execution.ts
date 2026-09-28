import { randomUUID } from "node:crypto";
import { withCompanyTx, type CompanyTransaction } from "@aqarak/db";
import { requestSha256 } from "@aqarak/domain";
import type { Context } from "hono";
import { decodeJsonColumn } from "./database-json";
import { routePath } from "hono/route";
import { z } from "zod";
import { resolveActor, type CompanyActor } from "./actor";
import type { KernelDependencies } from "./dependencies";
import { writeAuditEvent } from "./events";
import { Refusal, problemResponse } from "./problems";

export interface QueryContext {
  readonly tx: CompanyTransaction;
  readonly actor: CompanyActor;
  readonly companyId: string;
  readonly now: Date;
  readonly traceId: string;
}
export interface CommandContext extends QueryContext {
  readonly idempotencyKey: string;
  readonly channel: "web_form" | "mobile_form";
}
const requestHeaders = z.strictObject({
  channel: z.enum(["web_form", "mobile_form"]).default("web_form"),
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,128}$/)
    .optional(),
});
const storedResponse = z.strictObject({
  status: z.union([z.literal(200), z.literal(201)]),
  body: z.json(),
});
const storedAttempt = z.strictObject({
  request_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  response: z.preprocess(decodeJsonColumn, storedResponse.nullable()),
});

function jsonResponse(body: unknown, status = 200, replay = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(replay ? { "Idempotency-Replayed": "true" } : {}),
    },
  });
}

type RequestSubject = { type: string; id: string } | null;

/** I retain subjects supplied by existing audit route parameters at the boundary. */
function pathSubject(c: Context): RequestSubject {
  const subject = z
    .object({ type: z.string().regex(/^[a-z_]+$/), id: z.uuid() })
    .safeParse({
      type:
        c.req.param("subjectType") ??
        (c.req.param("eventId") ? "audit_event" : undefined),
      id: c.req.param("subjectId") ?? c.req.param("eventId"),
    });
  return subject.success ? subject.data : null;
}

interface RequestIdentity {
  companyId: string;
  accountId: string;
  traceId: string;
  channel: "web_form" | "mobile_form";
}

async function recordDenial(
  c: Context,
  deps: KernelDependencies,
  identity: RequestIdentity,
  denial: { refusal: Refusal; subject: RequestSubject },
): Promise<void> {
  const { refusal, subject: requestSubject } = denial;
  await withCompanyTx(deps.database, identity, async (tx) => {
    const company = await tx.execute(
      "select id from core.company where id = :company::uuid for update",
      [{ name: "company", value: identity.companyId }],
    );
    if (!company.rows.length) return;
    const subject = refusal.subject ??
      requestSubject ?? {
        type: "company",
        id: identity.companyId,
      };
    await writeAuditEvent(tx, identity.companyId, {
      eventType: "policy.denied",
      actorAccountId: identity.accountId,
      actorRole: null,
      initiator: "person",
      channel: identity.channel,
      subjectType: subject.type,
      subjectId: subject.id,
      versionBefore: null,
      versionAfter: null,
      reason: refusal.code,
      details: { route: `${c.req.method} ${routePath(c)}`, code: refusal.code },
      traceId: identity.traceId,
    });
  });
}

async function boundary<T>(
  c: Context,
  deps: KernelDependencies,
  options: {
    authorize: (actor: CompanyActor) => Refusal | null;
    command: boolean;
    subject: RequestSubject;
  },
  execute: (ctx: QueryContext, identity: RequestIdentity) => Promise<T>,
): Promise<T | Response> {
  let identity: RequestIdentity | null = null;
  try {
    const account = await deps.authenticator.authenticate(c.req.raw.headers);
    if (account === null) return problemResponse("SESSION_INVALID");
    const path = z
      .strictObject({ companyId: z.uuid() })
      .parse({ companyId: c.req.param("companyId") });
    const requestId = z.uuid().safeParse(c.req.header("X-Request-Id"));
    identity = {
      companyId: path.companyId,
      accountId: z.guid().parse(account.accountId),
      traceId: requestId.success ? requestId.data : randomUUID(),
      channel:
        c.req.header("X-Aqarak-Channel") === "mobile_form"
          ? "mobile_form"
          : "web_form",
    };
    const current = identity;
    return await withCompanyTx(deps.database, current, async (tx) => {
      // I serialize commands on the company row so chain-head and business-row
      // locks are always acquired in the same order. Queries do not take this lock.
      const company = await tx.execute(
        `select id from core.company where id = :company::uuid${options.command ? " for update" : ""}`,
        [{ name: "company", value: current.companyId }],
      );
      if (!company.rows.length) throw new Refusal("NOT_FOUND", null);
      const actor = await resolveActor(
        tx,
        current.companyId,
        current.accountId,
      );
      const refusal = options.authorize(actor);
      if (refusal) throw refusal;
      requestHeaders.parse({
        channel: c.req.header("X-Aqarak-Channel"),
        idempotencyKey: c.req.header("Idempotency-Key"),
      });
      return execute(
        {
          tx,
          actor,
          companyId: current.companyId,
          now: deps.now(),
          traceId: current.traceId,
        },
        current,
      );
    });
  } catch (error) {
    const refusal =
      error instanceof Refusal
        ? error
        : error instanceof z.ZodError
          ? new Refusal("VALIDATION_FAILED", null)
          : null;
    if (refusal) {
      if (identity && refusal.code !== "UNAVAILABLE") {
        try {
          await recordDenial(c, deps, identity, {
            refusal,
            subject: options.subject,
          });
        } catch {
          return problemResponse("UNAVAILABLE");
        }
      }
      return problemResponse(refusal.code, refusal.message, refusal.domainCode);
    }
    process.stderr.write("Company request failed\n");
    return problemResponse("UNAVAILABLE");
  }
}

/** Authenticates and authorizes before reserving or replaying a command, and audits rolled-back refusals. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- The shared command contract retains the caller response type.
export async function runCommand<T>(
  c: Context,
  deps: KernelDependencies,
  spec: {
    readonly subject?: RequestSubject;
    readonly commandType: string;
    readonly body: unknown;
    readonly authorize: (actor: CompanyActor) => Refusal | null;
    readonly execute: (
      ctx: CommandContext,
    ) => Promise<{ status: 200 | 201; body: T }>;
  },
): Promise<Response> {
  const result = await boundary(
    c,
    deps,
    {
      authorize: spec.authorize,
      command: true,
      subject: spec.subject ?? pathSubject(c),
    },
    async (ctx, identity) => {
      const headers = requestHeaders.parse({
        channel: c.req.header("X-Aqarak-Channel"),
        idempotencyKey: c.req.header("Idempotency-Key"),
      });
      if (!headers.idempotencyKey) throw new Refusal("VALIDATION_FAILED", null);
      const hash = requestSha256({
        pathParams: c.req.param(),
        body: z.json().parse(spec.body),
      });
      const params = [
        { name: "company", value: ctx.companyId },
        { name: "account", value: ctx.actor.account_id },
        { name: "command", value: spec.commandType },
        { name: "key", value: headers.idempotencyKey },
      ];
      const reservation = await ctx.tx.execute(
        `insert into ops.idempotency_key(company_id, account_id, command_type, key, request_sha256)
      values (:company::uuid, :account::uuid, :command, :key, :hash) on conflict do nothing returning key`,
        [...params, { name: "hash", value: hash }],
      );
      const where =
        "company_id = :company::uuid and account_id = :account::uuid and command_type = :command and key = :key";
      if (!reservation.rows.length) {
        const stored = await ctx.tx.execute(
          `select request_sha256, response from ops.idempotency_key where ${where}`,
          params,
        );
        const attempt = storedAttempt.parse(stored.rows[0]);
        if (attempt.request_sha256 !== hash)
          throw new Refusal("IDEMPOTENCY_KEY_REUSED", null);
        if (!attempt.response) throw new Refusal("UNAVAILABLE", null);
        return jsonResponse(
          attempt.response.body,
          attempt.response.status,
          true,
        );
      }
      const response = await spec.execute({
        ...ctx,
        idempotencyKey: headers.idempotencyKey,
        channel: identity.channel,
      });
      const validated = storedResponse.parse(response);
      await ctx.tx.execute(
        `update ops.idempotency_key set response = :response::jsonb where ${where}`,
        [...params, { name: "response", value: JSON.stringify(validated) }],
      );
      return jsonResponse(validated.body, validated.status);
    },
  );
  return result;
}

/** Runs a company query with the same authentication, authorization and denial boundary. */
export async function runQuery<T>(
  c: Context,
  deps: KernelDependencies,
  spec: {
    readonly subject?: RequestSubject;
    readonly authorize: (actor: CompanyActor) => Refusal | null;
    readonly execute: (ctx: QueryContext) => Promise<T>;
  },
): Promise<Response> {
  const result = await boundary(
    c,
    deps,
    {
      authorize: spec.authorize,
      command: false,
      subject: spec.subject ?? pathSubject(c),
    },
    spec.execute,
  );
  return result instanceof Response ? result : jsonResponse(result);
}
