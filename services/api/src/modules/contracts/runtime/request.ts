import type { Context } from "hono";
import { z } from "zod";
import { withCompanyTx, type CompanyTransaction } from "./db";
import { idempotencyKey } from "./domain";
import {
  authenticateIdentity,
  requestChannel,
  traceId,
  type Authenticate,
} from "./auth";
import { dependencyFactory, type WorkflowDependencies } from "./dependencies";
import { resolveActor, type Actor } from "./actor";
import { insertAudit, type AuditActor } from "./audit";
import { first } from "./sql";
import { WorkflowProblem, databaseProblem, problemResponse } from "./problem";
export interface WorkflowOptions {
  authenticate?: Authenticate;
  dependencies?: Partial<WorkflowDependencies>;
}
export interface RequestContext {
  tx: CompanyTransaction;
  actor: Actor;
  audit: AuditActor;
  dependencies: WorkflowDependencies;
  request: Request;
  company: Record<string, unknown>;
}
export interface RouteInput<T> {
  command: string;
  schema: z.ZodType<T>;
  mutation?: boolean;
  run: (
    context: RequestContext,
    body: T,
    params: Record<string, string>,
  ) => Promise<Response>;
}
export type WorkflowRuntime = <T>(
  input: RouteInput<T>,
) => (context: Context) => Promise<Response>;
export function createRuntime(options: WorkflowOptions = {}): WorkflowRuntime {
  const authenticate = options.authenticate ?? authenticateIdentity;
  const dependencies = dependencyFactory(options.dependencies);
  return (input) => async (c) => {
    let audit: AuditActor | undefined;
    const state = { companyExists: false, actorResolved: false };
    try {
      const identity = await authenticate(c.req.raw);
      if (!identity || !z.guid().safeParse(identity.accountId).success)
        throw new WorkflowProblem("SESSION_INVALID");
      const params = c.req.param();
      if (
        !Object.values(params).every(
          (value) => z.uuid().safeParse(value).success,
        )
      )
        throw new WorkflowProblem("VALIDATION_FAILED", "id");
      const companyId = z.uuid().parse(params.companyId);
      const key = requestKey(c, Boolean(input.mutation));
      const body = await requestBody(c, input);
      audit = {
        companyId,
        accountId: identity.accountId,
        role: null,
        channel: requestChannel(c.req.raw),
        traceId: traceId(c.req.raw),
        key,
      };
      const actorAudit = audit;
      const deps = dependencies();
      return await withCompanyTx(deps.executor, audit, async (tx) => {
        const company = await first(
          tx,
          "select * from core.company where id=:id::uuid",
          { id: companyId },
        );
        if (!company) throw new WorkflowProblem("NOT_FOUND");
        state.companyExists = true;
        const actor = await resolveActor(tx, identity.accountId, companyId);
        state.actorResolved = true;
        actorAudit.role = auditRole(actor);
        return input.run(
          {
            tx,
            actor,
            audit: actorAudit,
            dependencies: deps,
            request: c.req.raw,
            company,
          },
          body,
          params,
        );
      });
    } catch (cause) {
      const error = databaseProblem(cause);
      if (state.companyExists && audit && error.status !== 503) {
        try {
          const params = c.req.param();
          const denialActor = audit;
          await withCompanyTx(dependencies().executor, audit, async (tx) => {
            await insertAudit(tx, denialActor, {
              eventType: "policy.denied",
              subjectType:
                state.actorResolved && params.contractId
                  ? "contract"
                  : "company",
              subjectId: state.actorResolved
                ? (params.contractId ?? denialActor.companyId)
                : denialActor.companyId,
              denied: [error.code, input.command],
            });
          });
        } catch {
          return problemResponse(new WorkflowProblem("UNAVAILABLE"));
        }
      }
      return problemResponse(error);
    }
  };
}
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function auditRole(actor: Actor): AuditActor["role"] {
  if (actor.manager) return "manager";
  if (actor.ownerIds.length) return "owner";
  if (actor.tenantIds.length) return "tenant";
  return null;
}

function requestKey(c: Context, mutation: boolean): string | null {
  if (!mutation) return null;
  const key = idempotencyKey.safeParse(c.req.header("Idempotency-Key"));
  if (!key.success)
    throw new WorkflowProblem("VALIDATION_FAILED", "Idempotency-Key");
  return key.data;
}
async function requestBody<T>(c: Context, input: RouteInput<T>): Promise<T> {
  const raw: unknown = input.mutation
    ? await c.req.json().catch(() => {
        throw new WorkflowProblem("VALIDATION_FAILED");
      })
    : c.req.query();
  const parsed = input.schema.safeParse(raw);
  if (!parsed.success)
    throw new WorkflowProblem(
      "VALIDATION_FAILED",
      parsed.error.issues[0]?.path.join("."),
    );
  return parsed.data;
}
