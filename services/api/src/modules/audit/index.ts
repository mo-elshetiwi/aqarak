import { can, sha256Hex } from "@aqarak/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ApiModule } from "../index";
import {
  createAuthenticator,
  kernelDependenciesFromEnvironment,
  problemResponse,
  Refusal,
  runCommand,
  runQuery,
  writeAuditEvent,
  coverTransactionVersions,
  type KernelDependencies,
  type CompanyActor,
} from "./kernel";
import { parseFilters, readEvents, readVersions, subjectType } from "./views";
import { encodeCsv } from "./csv";
import { anchorCompany, verifyCompany } from "./chain";

/** Requires the domain grant to cover the whole company for the trail API. */
export function authorizeAudit(actor: CompanyActor): Refusal | null {
  const decision = can(actor, "read", "audit_read", {
    company_id: actor.company_id,
  });
  // Personal-scope cells cannot authorize the company trail even when the company exists.
  return decision.ok && decision.value.scope === "company"
    ? null
    : new Refusal("NOT_PERMITTED", null);
}

function noQuery(c: Context): void {
  z.strictObject({}).parse(c.req.query());
}
function companyPath(c: Context): void {
  z.strictObject({ companyId: z.uuid() }).parse(c.req.param());
}

/** Builds independently injectable routes; environment access is deferred until a request. */
export function createAuditModule(injected?: KernelDependencies): ApiModule {
  let cached: KernelDependencies | undefined = injected;
  function handler(
    action: (c: Context, deps: KernelDependencies) => Promise<Response>,
  ): (c: Context) => Promise<Response> {
    return async (c) => {
      c.header("Cache-Control", "no-store");
      try {
        if (
          !cached &&
          !(await createAuthenticator().authenticate(c.req.raw.headers))
        )
          return problemResponse("SESSION_INVALID");
      } catch {
        return problemResponse("UNAVAILABLE");
      }
      let deps: KernelDependencies;
      try {
        deps = cached ??= kernelDependenciesFromEnvironment();
      } catch {
        return problemResponse("UNAVAILABLE");
      }
      try {
        return await action(c, deps);
      } catch (error) {
        const refusal =
          error instanceof Refusal
            ? error
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? new Refusal("VALIDATION_FAILED", null)
              : new Refusal("UNAVAILABLE", null);
        return runQuery(c, deps, {
          authorize: authorizeAudit,
          execute: () => Promise.reject(refusal),
        });
      }
    };
  }
  return {
    name: "audit",
    basePath: "/v1/companies/:companyId/audit",
    register(app: Hono) {
      app.get(
        "/events",
        handler((c, deps) =>
          runQuery(c, deps, {
            authorize: authorizeAudit,
            async execute(ctx) {
              companyPath(c);
              const filters = parseFilters(c.req.queries());
              const events = await readEvents(ctx.tx, ctx.companyId, filters);
              const page = events.slice(0, filters.limit);
              return {
                events: page,
                nextCursor:
                  events.length > filters.limit
                    ? (page.at(-1)?.seq ?? null)
                    : null,
              };
            },
          }),
        ),
      );
      app.get(
        "/subjects/:subjectType/:subjectId/versions",
        handler((c, deps) =>
          runQuery(c, deps, {
            authorize: authorizeAudit,
            async execute(ctx) {
              const path = z
                .strictObject({
                  companyId: z.uuid(),
                  subjectType,
                  subjectId: z.guid(),
                })
                .parse(c.req.param());
              noQuery(c);
              const subject = { type: path.subjectType, id: path.subjectId };
              return {
                subject,
                versions: await readVersions(ctx.tx, ctx.companyId, subject),
              };
            },
          }),
        ),
      );
      for (const [path, commandType, status, execute] of [
        ["/verification", "audit.verification", 200, verifyCompany],
        ["/anchors", "audit.anchor", 201, anchorCompany],
      ] as const) {
        app.post(
          path,
          handler(async (c, deps) => {
            const body = z.strictObject({}).parse(await c.req.json<unknown>());
            return runCommand(c, deps, {
              commandType,
              body,
              authorize: authorizeAudit,
              async execute(ctx) {
                companyPath(c);
                noQuery(c);
                return { status, body: await execute(ctx, deps) };
              },
            });
          }),
        );
      }
      app.get(
        "/export.csv",
        handler((c, deps) =>
          runQuery(c, deps, {
            authorize: authorizeAudit,
            async execute(ctx) {
              companyPath(c);
              const filters = parseFilters(c.req.queries(), true);
              const events = await readEvents(
                ctx.tx,
                ctx.companyId,
                filters,
                true,
              );
              const body = encodeCsv(events);
              const event = await writeAuditEvent(ctx.tx, ctx.companyId, {
                eventType: "export.performed",
                actorAccountId: ctx.actor.account_id,
                actorRole: ctx.actor.roles[0] ?? null,
                initiator: "person",
                channel:
                  c.req.header("X-Aqarak-Channel") === "mobile_form"
                    ? "mobile_form"
                    : "web_form",
                subjectType: "company",
                subjectId: ctx.companyId,
                versionBefore: null,
                versionAfter: null,
                details: {
                  rows: events.length,
                  sha256: sha256Hex(body),
                  filters,
                },
                traceId: ctx.traceId,
              });
              await coverTransactionVersions(
                ctx.tx,
                ctx.companyId,
                event.eventId,
              );
              const stamp = ctx.now
                .toISOString()
                .replaceAll(/[-:]/g, "")
                .replace(/\.\d{3}Z$/, "Z");
              return new Response(body, {
                headers: {
                  "Content-Type": "text/csv; charset=utf-8",
                  "Cache-Control": "no-store",
                  "Content-Disposition": `attachment; filename="audit-${ctx.companyId}-${stamp}.csv"`,
                },
              });
            },
          }),
        ),
      );
      for (const method of ["PATCH", "DELETE"])
        app.on(
          method,
          "/events/:eventId",
          handler((c, deps) =>
            runQuery(c, deps, {
              authorize: authorizeAudit,
              execute() {
                const path = z
                  .strictObject({ companyId: z.uuid(), eventId: z.uuid() })
                  .parse(c.req.param());
                noQuery(c);
                return Promise.reject(
                  new Refusal("METHOD_NOT_ALLOWED", {
                    type: "audit_event",
                    id: path.eventId,
                  }),
                );
              },
            }),
          ),
        );
    },
  };
}
export const audit = createAuditModule();
