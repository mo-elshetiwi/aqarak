import { memberRoutes, registerMembers } from "./members";
import { invitationRoutes, registerInvitations } from "./invitations";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiModule } from "../index";
import {
  authenticate,
  boundary,
  respond,
  type IdentityVariables,
} from "../identity/guard";
import { auditEvent, one } from "../identity/database";
import { dependencies, type DependencySource } from "../identity/ports";
import { body } from "../identity/problems";
import { runtimeDependencies } from "../identity/runtime";
import { companyCreate, companyPatch } from "../identity/schemas";
import { createCompany, companyProjection } from "./company";
import {
  checkVersion,
  registerRoute,
  targetRow,
  type RouteDefinition,
} from "./routes";
const settingsRoutes = [
  {
    method: "GET",
    path: "/:companyId",
    capability: "company_settings",
    table: "company",
  },
  {
    method: "PATCH",
    path: "/:companyId",
    capability: "company_settings",
    table: "company",
  },
] as const satisfies readonly RouteDefinition[];
export const companyRoutes: readonly RouteDefinition[] = [
  ...settingsRoutes,
  ...memberRoutes,
  ...invitationRoutes,
];
export function createCompaniesModule(source: DependencySource): ApiModule {
  return {
    name: "companies",
    basePath: "/v1/companies",
    register(app) {
      const routes = new Hono<{ Variables: IdentityVariables }>();
      routes.post("/", authenticate(source), (c) =>
        boundary(c, async () =>
          respond(
            c,
            await createCompany(
              dependencies(source),
              c.get("principal"),
              await body(c, companyCreate),
              c.req.header("Idempotency-Key"),
            ),
          ),
        ),
      );
      registerRoute(routes, source, settingsRoutes[0], {
        schema: z.null(),
        run: ({ target }) =>
          Promise.resolve({
            status: 200,
            body: { company: companyProjection(targetRow(target)) },
          }),
      });
      registerRoute(routes, source, settingsRoutes[1], {
        schema: companyPatch,
        run: async ({
          tx,
          principal,
          companyId,
          input,
          target,
          role,
          permission,
          key,
        }) => {
          const before = targetRow(target);
          checkVersion(before, input.expectedVersion);
          const changedFields = [
            ...(input.name ? ["legal_name_en", "legal_name_ar"] : []),
            ...(input.tradeLicenceNumber !== undefined
              ? ["trade_licence_no"]
              : []),
            ...(input.trn !== undefined ? ["trn"] : []),
          ];
          const after = await one(
            tx,
            `update core.company set legal_name_en=:en,legal_name_ar=:ar,trade_licence_no=:licence,trn=:trn where id=cast(:id as uuid) returning *`,
            {
              id: companyId,
              en: input.name?.en ?? String(before.legal_name_en),
              ar: input.name?.ar ?? String(before.legal_name_ar),
              licence:
                input.tradeLicenceNumber === undefined
                  ? (before.trade_licence_no as string | null)
                  : input.tradeLicenceNumber,
              trn:
                input.trn === undefined
                  ? (before.trn as string | null)
                  : input.trn,
            },
          );
          await auditEvent(tx, {
            companyId,
            principal,
            eventType: "company.updated",
            primary: {
              type: "company",
              id: companyId,
              before: Number(before.version),
              after: Number(after.version),
            },
            role,
            permission,
            changedFields,
            ...(key ? { key } : {}),
          });
          return { status: 200, body: { company: companyProjection(after) } };
        },
      });
      registerMembers(routes, source);
      registerInvitations(routes, source);
      app.route("/", routes);
    },
  };
}
export const companiesModule = createCompaniesModule(runtimeDependencies);
