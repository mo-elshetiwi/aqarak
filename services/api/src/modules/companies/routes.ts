import { Hono } from "hono";
import { z } from "zod";
import type { CompanyTransaction, Row } from "@aqarak/db";
import type { Capability, PermissionActor, Role } from "@aqarak/domain";
import {
  authenticate,
  authorize,
  boundary,
  commandTx,
  respond,
  type IdentityVariables,
  type Principal,
  type RoutePermission,
} from "../identity/guard";
import {
  one,
  parseKey,
  withIdempotency,
  type CommandResponse,
} from "../identity/database";
import {
  dependencies,
  type Dependencies,
  type DependencySource,
} from "../identity/ports";
import { body, Refusal } from "../identity/problems";
export interface RouteDefinition {
  method: "GET" | "PATCH" | "POST";
  path: string;
  capability: Capability;
  table?: "company" | "membership" | "invitation";
  idParam?: "membershipId" | "invitationId";
}
export interface RouteInput<T> {
  tx: CompanyTransaction;
  deps: Dependencies;
  principal: Principal;
  companyId: string;
  input: T;
  actor: PermissionActor;
  role: Role | null;
  target: Row | null;
  permission: RoutePermission;
  key: string | undefined;
}
export function registerRoute<T>(
  routes: Hono<{ Variables: IdentityVariables }>,
  source: DependencySource,
  definition: RouteDefinition,
  options: {
    schema: z.ZodType<T>;
    capability?: (input: T, target: Row | null) => Capability;
    run: (input: RouteInput<T>) => Promise<CommandResponse>;
    replayBody?: (body: unknown) => unknown;
    afterCommit?: (input: {
      deps: Dependencies;
      principal: Principal;
      companyId: string;
      response: CommandResponse;
      role: Role | null;
      permission: RoutePermission;
      key: string | undefined;
    }) => Promise<CommandResponse>;
  },
): void {
  routes.on(definition.method, definition.path, authenticate(source), (c) =>
    boundary(c, async () => {
      const deps = dependencies(source);
      const principal = c.get("principal");
      const companyId = c.req.param("companyId") ?? "";
      const input =
        definition.method === "GET"
          ? options.schema.parse(null)
          : await body(c, options.schema);
      const key = parseKey(c.req.header("Idempotency-Key"));
      const subjectId = definition.idParam
        ? (c.req.param(definition.idParam) ?? "")
        : companyId;
      const permission: RoutePermission = {
        method: definition.method,
        route: `/v1/companies${definition.path}`,
        capability: definition.capability,
        operation: definition.method === "GET" ? "read" : "write",
        subjectType: definition.table ?? "company",
        subjectId,
      };
      let authorizedRole: Role | null = null;
      let response = await commandTx(
        { deps, principal, companyId, permission },
        async (tx, actor) => {
          let target: Row | null = null;
          if (definition.table) {
            if (!z.uuid().safeParse(subjectId).success)
              throw new Refusal("NOT_FOUND");
            target = await one(
              tx,
              `select * from core.${definition.table} where company_id=cast(:company as uuid) and id=cast(:id as uuid) for update`,
              { company: companyId, id: subjectId },
            );
          }
          permission.capability =
            options.capability?.(input, target) ?? definition.capability;
          const role = authorize(actor, permission, {
            company_id: actor.company_id,
          });
          authorizedRole = role;
          const run = (): Promise<CommandResponse> =>
            options.run({
              tx,
              deps,
              principal,
              companyId,
              input,
              actor,
              role,
              target,
              permission,
              key,
            });
          return definition.method === "GET"
            ? run()
            : withIdempotency(
                tx,
                {
                  companyId,
                  accountId: principal.accountId,
                  command: `${definition.method} ${definition.path}`,
                  key,
                  path: { companyId, subjectId },
                  body: input,
                },
                run,
                options.replayBody,
              );
        },
      );
      if (!response.replayed && options.afterCommit)
        response = await options.afterCommit({
          deps,
          principal,
          companyId,
          response,
          role: authorizedRole,
          permission,
          key,
        });
      return respond(c, response);
    }),
  );
}
export function targetRow(target: Row | null): Row {
  if (!target) throw new Refusal("NOT_FOUND");
  return target;
}
export function checkVersion(target: Row, expectedVersion: number): void {
  if (Number(target.version) !== expectedVersion)
    throw new Refusal("VERSION_CONFLICT");
}
