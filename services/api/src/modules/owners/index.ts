import {
  inviteOwner,
  invitationSchema,
  invitationResponseSchema,
} from "./invitation";
import { registerDocumentRoutes } from "../properties/lib/document-routes";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { ApiModule } from "../index";
import { estateApp, registerRoute } from "../properties/lib/routes";
import type { RuntimePorts } from "../properties/lib/runtime";
import {
  createOwnerSchema,
  updateOwnerSchema,
  bankSchema,
  mandateSchema,
  mandateDetailSchema,
  ownerSummarySchema,
  ownerDetailSchema,
  ownerListItemSchema,
  ownerQuerySchema,
} from "../properties/lib/schemas";
import { createOwner, editOwner, putMandate, bankDetails } from "./commands";
import { listOwners, ownerDetail } from "./read";
import { one } from "../properties/lib/sql";
export function createOwnersApp(ports?: RuntimePorts): OpenAPIHono {
  const app = estateApp();
  const base = { root: "owner" as const, capability: "owners" as const };
  registerRoute(
    app,
    {
      method: "get",
      path: "/",
      query: ownerQuerySchema,
      response: z.object({
        items: z.array(ownerListItemSchema),
        nextCursor: z.string().nullable(),
      }),
      operation: {
        ...base,
        command: "owners.list",
        write: false,
        execute: async (scope, _body, query) => ({
          status: 200,
          body: await listOwners(scope, query),
        }),
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "post",
      path: "/",
      body: createOwnerSchema,
      response: z.object({ owner: ownerSummarySchema }),
      operation: {
        ...base,
        command: "owner.create",
        write: true,
        roles: ["manager"],
        execute: createOwner,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "get",
      path: "/{ownerId}",
      response: ownerDetailSchema,
      operation: {
        ...base,
        command: "owner.read",
        write: false,
        execute: async (scope) => ({
          status: 200,
          body: await ownerDetail(scope, one(scope.root ? [scope.root] : [])),
        }),
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "patch",
      path: "/{ownerId}",
      body: updateOwnerSchema,
      response: z.object({ owner: ownerSummarySchema }),
      operation: {
        ...base,
        command: "owner.update",
        write: true,
        roles: ["manager", "owner"],
        execute: editOwner,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "put",
      path: "/{ownerId}/mandate",
      body: mandateSchema,
      response: z.object({ mandate: mandateDetailSchema }),
      operation: {
        ...base,
        command: "owner.mandate",
        write: true,
        roles: ["manager"],
        execute: putMandate,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "put",
      path: "/{ownerId}/bank-details",
      body: bankSchema,
      response: z.object({ owner: ownerSummarySchema }),
      operation: {
        ...base,
        capability: "owner_bank_details",
        command: "owner.bank_details",
        write: true,
        roles: ["manager", "accountant"],
        execute: bankDetails,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "post",
      path: "/{ownerId}/invitation",
      body: invitationSchema,
      response: invitationResponseSchema,
      operation: {
        ...base,
        command: "owner.invitation",
        write: true,
        roles: ["manager"],
        execute: (scope, body) => inviteOwner(scope, body),
      },
    },
    ports,
  );
  registerDocumentRoutes(app, "owner", ports);
  return app;
}
export const ownersModule: ApiModule = {
  name: "owners",
  basePath: "/v1/companies/:companyId/owners",
  register(app) {
    app.route("/", createOwnersApp());
  },
};
