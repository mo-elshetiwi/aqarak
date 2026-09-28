import { Hono, type Context } from "hono";
import { z } from "zod";
import { can, type TawtheeqCommand } from "@aqarak/domain";
import type { ApiModule } from "../index";
import {
  runCommand,
  runQuery,
  Refusal,
  problemResponse,
  type CompanyActor,
  type CommandContext,
} from "../audit/kernel";
import {
  dependenciesFromEnvironment,
  type TawtheeqDependencies,
} from "./dependencies";
import {
  loadRecord,
  requireAccess,
  subjectOf,
  type LoadedRecord,
} from "./repository";
import { freshView, recordView, daysPending } from "./views";
import { rows } from "./storage";
import { expected, reasonBody, ownerDecision } from "./schemas";
import {
  openRecord,
  review,
  resolve,
  skip,
  skipConfirmation,
} from "./commands";
import { decide, applyDecision } from "./workflow";
import {
  initiateUpload,
  completeUpload,
  completionDocument,
  inspectUploadedDocument,
  documentUrl,
  type UploadDocument,
  type UploadInspection,
} from "./uploads";
import {
  extract,
  prepareExtraction,
  storeExtractionResult,
  persistExtraction,
  extractionEnvelope,
  type ExtractionInput,
} from "./extraction";
import { domainProblemStatus } from "./problems";
import { registerRetroactiveRoutes } from "./retroactive-routes";
const basePath = "/v1/companies/:companyId/tawtheeq";
function authorize(
  actor: CompanyActor,
  mode: "read" | "write" | "owner",
): Refusal | null {
  if (mode === "owner")
    return actor.roles.includes("owner")
      ? null
      : new Refusal("NOT_PERMITTED", null);
  const permission = can(actor, mode, "tawtheeq", {
    company_id: actor.company_id,
    owner_ids: actor.owner_ids,
    tenant_ids: actor.tenant_ids,
  });
  return permission.ok ? null : new Refusal("NOT_PERMITTED", null);
}
function recordSubject(
  c: Context,
): { type: "tawtheeq_record"; id: string } | null {
  const id = z.uuid().safeParse(c.req.param("recordId"));
  return id.success ? { type: "tawtheeq_record", id: id.data } : null;
}
async function bodyOf(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
async function command(
  c: Context,
  deps: TawtheeqDependencies,
  name: string,
  execute: (
    ctx: CommandContext,
    data: LoadedRecord,
    body: unknown,
  ) => Promise<unknown>,
): Promise<Response> {
  const mode =
    name === "owner-reapproval" || name === "skip-confirmation"
      ? "owner"
      : "write";
  if (mode === "owner") {
    const access = await runQuery(c, deps, {
      subject: recordSubject(c),
      authorize: (actor) => authorize(actor, mode),
      execute: async (ctx) => {
        const data = await loadRecord(
          ctx,
          z.uuid().parse(c.req.param("recordId")),
        );
        requireAccess(
          ctx.actor,
          data,
          mode,
          name === "skip-confirmation" ? "skip_confirmation" : "reapproval",
        );
        return {};
      },
    });
    if (!access.ok) return access;
  }
  const body = await bodyOf(c);
  return domainProblemStatus(
    await runCommand(c, deps, {
      subject: recordSubject(c),
      commandType: `tawtheeq.${name}`,
      body,
      authorize: (actor) => authorize(actor, mode),
      execute: async (ctx) => {
        const data = await loadRecord(
          ctx,
          z.uuid().parse(c.req.param("recordId")),
        );
        requireAccess(
          ctx.actor,
          data,
          mode,
          name === "skip-confirmation" ? "skip_confirmation" : "reapproval",
        );
        return {
          status: name === "uploads" ? 201 : 200,
          body: await execute(ctx, data, body),
        };
      },
    }),
  );
}
async function transition(
  ctx: CommandContext,
  data: LoadedRecord,
  input: TawtheeqCommand,
): Promise<unknown> {
  await applyDecision(ctx, data, input, decide(ctx, data, input));
  return freshView(ctx, data.record.id);
}
/** Registers the HTTP contract with lazily resolved deployment dependencies. */
export function createTawtheeqModule(
  dependencies?: TawtheeqDependencies,
): ApiModule {
  const deps = (): TawtheeqDependencies =>
    dependencies ?? dependenciesFromEnvironment();
  return {
    name: "tawtheeq",
    basePath,
    register(app) {
      registerRetroactiveRoutes(app, deps);
      app.get("/", (c) =>
        runQuery(c, deps(), {
          subject: recordSubject(c),
          authorize: (actor) => authorize(actor, "read"),
          execute: async (ctx) => {
            z.strictObject({
              limit: z.coerce.number().int().min(1).max(200).optional(),
            }).parse(c.req.query());
            const records = await rows(
              ctx.tx,
              "select id from lease.tawtheeq_record where company_id=:company::uuid order by workflow_state,created_at,id",
              z.object({ id: z.uuid() }),
              { company: ctx.companyId },
            );
            const visible = [];
            for (const item of records) {
              const data = await loadRecord(ctx, item.id);
              if (!can(ctx.actor, "read", "tawtheeq", subjectOf(data)).ok)
                continue;
              visible.push({
                id: data.record.id,
                contractId: data.contract.id,
                contractNo: data.contract.contract_no,
                unitLabel: data.unit.unit_no,
                tenantName:
                  data.tenant.full_name_en ?? data.tenant.full_name_ar,
                workflowState: data.record.workflow_state,
                portalStatus: data.record.portal_status,
                path: data.record.path,
                daysPending: daysPending(data, ctx.now),
                openDiscrepancies: data.discrepancies.filter(
                  (item) => item.status === "open",
                ).length,
                updatedAt: data.record.updated_at ?? data.record.created_at,
              });
            }
            return { records: visible };
          },
        }),
      );
      app.post("/", async (c) =>
        runCommand(c, deps(), {
          commandType: "tawtheeq.open",
          body: await bodyOf(c),
          authorize: (actor) => authorize(actor, "write"),
          execute: async (ctx) => ({
            status: 201,
            body: await recordView(ctx, await openRecord(ctx, await bodyOf(c))),
          }),
        }),
      );
      app.get("/:recordId", (c) =>
        runQuery(c, deps(), {
          subject: recordSubject(c),
          authorize: (actor) => authorize(actor, "read"),
          execute: async (ctx) => {
            const data = await loadRecord(
              ctx,
              z.uuid().parse(c.req.param("recordId")),
            );
            requireAccess(ctx.actor, data, "read");
            return recordView(ctx, data);
          },
        }),
      );
      app.get("/:recordId/document-url", (c) =>
        runQuery(c, deps(), {
          subject: recordSubject(c),
          authorize: (actor) => authorize(actor, "read"),
          execute: async (ctx) => {
            const data = await loadRecord(
              ctx,
              z.uuid().parse(c.req.param("recordId")),
            );
            requireAccess(ctx.actor, data, "read");
            if (
              !ctx.actor.roles.includes("manager") &&
              !data.ownerIds.some((id) =>
                ctx.actor.owner_ids.includes(
                  id as (typeof ctx.actor.owner_ids)[number],
                ),
              ) &&
              !ctx.actor.tenant_ids.includes(
                data.tenant.id as (typeof ctx.actor.tenant_ids)[number],
              )
            )
              throw new Refusal("NOT_PERMITTED", null);
            return documentUrl(ctx, deps(), data);
          },
        }),
      );
      app.post("/:recordId/attest-portal", (c) =>
        command(c, deps(), "attest-portal", (ctx, data, body) =>
          transition(ctx, data, {
            type: "attest_portal",
            ...expected.parse(body),
          }),
        ),
      );
      app.post("/:recordId/portal-return", (c) =>
        command(c, deps(), "portal-return", (ctx, data, body) => {
          const input = reasonBody.parse(body);
          return transition(ctx, data, {
            type: "portal_return",
            expectedVersion: input.expectedVersion,
            reason: input.reason ?? null,
          });
        }),
      );
      app.post("/:recordId/resume", (c) =>
        command(c, deps(), "resume", (ctx, data, body) =>
          transition(ctx, data, { type: "resume", ...expected.parse(body) }),
        ),
      );
      app.post("/:recordId/skip", (c) =>
        command(c, deps(), "skip", async (ctx, data, body) => {
          await skip(ctx, data, body);
          return freshView(ctx, data.record.id);
        }),
      );
      app.post("/:recordId/skip-confirmation", (c) =>
        command(c, deps(), "skip-confirmation", async (ctx, data, body) => {
          await skipConfirmation(ctx, data, body);
          return freshView(ctx, data.record.id);
        }),
      );
      app.post("/:recordId/uploads", (c) =>
        command(c, deps(), "uploads", (ctx, data, body) =>
          initiateUpload(ctx, deps(), data, body),
        ),
      );
      app.post("/:recordId/uploads/:documentVersionId/complete", async (c) => {
        const dependencies = deps();
        const prepared: { document?: UploadDocument } = {};
        const access = await runQuery(c, dependencies, {
          subject: recordSubject(c),
          authorize: (actor) => authorize(actor, "write"),
          execute: async (ctx) => {
            expected.parse(await bodyOf(c));
            const data = await loadRecord(
              ctx,
              z.uuid().parse(c.req.param("recordId")),
            );
            requireAccess(ctx.actor, data, "write");
            prepared.document = await completionDocument(
              ctx,
              data,
              z.uuid().parse(c.req.param("documentVersionId")),
            );
            return {};
          },
        });
        if (!access.ok) return access;
        const document = prepared.document;
        if (!document) return problemResponse("UNAVAILABLE");
        let result: UploadInspection | null = null;
        try {
          // I inspect storage only after the read transaction has committed.
          if (
            ["awaiting_upload", "uploaded"].includes(document.processing_status)
          )
            result = await inspectUploadedDocument(dependencies, document);
        } catch {
          return problemResponse("UNAVAILABLE");
        }
        const response = await command(
          c,
          dependencies,
          "complete",
          async (ctx, data, body) => {
            const status = await completeUpload(
              ctx,
              data,
              {
                ...expected.parse(body),
                documentVersionId: z
                  .uuid()
                  .parse(c.req.param("documentVersionId")),
              },
              { document, result },
            );
            return { status, view: await freshView(ctx, data.record.id) };
          },
        );
        if (!response.ok) return response;
        const value = z
          .object({
            status: z.enum(["scan_clean", "scan_rejected", "uploaded"]),
            view: z.record(z.string(), z.unknown()),
          })
          .parse(await response.json());
        if (value.status === "scan_clean")
          return new Response(JSON.stringify(value.view), {
            status: 200,
            headers: response.headers,
          });
        const pending = value.status === "uploaded";
        const status = pending ? 409 : 422;
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title: pending ? "Conflict" : "Unprocessable Content",
            status,
            code: pending ? "INVALID_TRANSITION" : "VALIDATION_FAILED",
            domainCode: pending ? "SCAN_PENDING" : "SCAN_REJECTED",
            detail: pending
              ? "The uploaded document is waiting for a clean malware scan."
              : "The uploaded document failed integrity or malware checks.",
          }),
          {
            status,
            headers: {
              ...Object.fromEntries(response.headers),
              "Content-Type": "application/problem+json",
            },
          },
        );
      });
      app.post("/:recordId/extraction", async (c) => {
        const dependencies = deps();
        const reservation: { input?: ExtractionInput } = {};
        const response = await command(
          c,
          dependencies,
          "extraction",
          async (ctx, data, body) => {
            z.strictObject({}).parse(body);
            reservation.input = await prepareExtraction(ctx, data);
            return { pending: true };
          },
        );
        if (!response.ok) return response;
        try {
          const stored: unknown = await response.json();
          if (
            !reservation.input &&
            !extractionEnvelope.safeParse(stored).success
          )
            return problemResponse(
              "UNAVAILABLE",
              "Extraction is still pending.",
            );
          const value = reservation.input
            ? await extract(reservation.input, dependencies)
            : extractionEnvelope.parse(stored);
          if (reservation.input)
            await storeExtractionResult(dependencies, reservation.input, value);
          await persistExtraction(dependencies, value);
          if (
            value.attempts.some(
              (attempt) => attempt.record.status === "timeout",
            )
          )
            return problemResponse(
              "UNAVAILABLE",
              "Extraction timed out. The receipt was retained; manual review remains available.",
            );
          return new Response(JSON.stringify(value.response), {
            status: 200,
            headers: response.headers,
          });
        } catch {
          return problemResponse("UNAVAILABLE");
        }
      });
      app.post("/:recordId/review", (c) =>
        command(c, deps(), "review", async (ctx, data, body) => {
          await review(ctx, data, body);
          return freshView(ctx, data.record.id);
        }),
      );
      app.post("/:recordId/resolutions", (c) =>
        command(c, deps(), "resolutions", async (ctx, data, body) => {
          await resolve(ctx, data, body);
          return freshView(ctx, data.record.id);
        }),
      );
      app.post("/:recordId/owner-reapproval", (c) =>
        command(c, deps(), "owner-reapproval", (ctx, data, body) => {
          const input = ownerDecision
            .extend({ expectedVersion: z.number().int().positive() })
            .parse(body);
          return transition(
            ctx,
            data,
            input.decision === "approve"
              ? {
                  type: "owner_reapprove",
                  expectedVersion: input.expectedVersion,
                  subjectHash:
                    data.review?.fields._adoption?.contentHash ??
                    data.current.content_hash,
                }
              : {
                  type: "owner_return",
                  expectedVersion: input.expectedVersion,
                  reason: input.reason ?? null,
                },
          );
        }),
      );
    },
  };
}
export const tawtheeqModule: ApiModule = createTawtheeqModule();
export function tawtheeqApplication(dependencies: TawtheeqDependencies): Hono {
  const app = new Hono();
  const routes = new Hono();
  createTawtheeqModule(dependencies).register(routes);
  app.route(basePath, routes);
  return app;
}
