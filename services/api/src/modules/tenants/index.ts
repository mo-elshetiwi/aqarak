import { authenticateRequest } from "../identity/adapters";
import type { ApiModule } from "..";
import {
  type J3Dependencies,
  type AccountAuthenticator,
  authorize,
} from "../documents/context";
import { lazyDependencies } from "../documents/dependencies";
import { routeHandler, emptyBody } from "../documents/http";
import {
  createTenant,
  listTenants,
  getTenant,
  inviteTenant,
  tenantSchema,
} from "./commands";
import { saveIdentity, saveSchema } from "./save";
import { loadTenant } from "./read";

function moduleFor(
  authenticate: AccountAuthenticator,
  resolve: () => J3Dependencies,
): ApiModule {
  return {
    name: "tenants",
    basePath: "/v1/companies/:companyId/tenants",
    register(app) {
      app.post(
        "/",
        routeHandler(authenticate, resolve, {
          command: "tenant.create",
          authorize: (ctx) => {
            authorize(ctx, {
              operation: "write",
              capability: "tenants_occupants",
              companyScope: true,
            });
          },
          schema: tenantSchema,
          run: createTenant,
        }),
      );
      app.get(
        "/",
        routeHandler(authenticate, resolve, {
          schema: emptyBody,
          run: listTenants,
        }),
      );
      app.get(
        "/:tenantId",
        routeHandler(authenticate, resolve, {
          schema: emptyBody,
          run: getTenant,
        }),
      );
      app.post(
        "/:tenantId/invitations",
        routeHandler(authenticate, resolve, {
          command: "tenant.invite",
          authorize: async (ctx) => {
            await loadTenant(ctx, ctx.params.tenantId ?? "", "write", true);
          },
          schema: emptyBody,
          run: inviteTenant,
        }),
      );
      app.post(
        "/:tenantId/identity",
        routeHandler(authenticate, resolve, {
          command: "tenant.identity",
          authorize: async (ctx) => {
            await loadTenant(ctx, ctx.params.tenantId ?? "", "write", true);
          },
          schema: saveSchema,
          run: saveIdentity,
        }),
      );
    },
  };
}
export function createTenantsModule(deps: J3Dependencies): ApiModule {
  return moduleFor(deps.authenticate, () => deps);
}
export const tenantsModule: ApiModule = moduleFor(
  authenticateRequest,
  lazyDependencies(),
);
export { documentsModule } from "../documents";
export type { J3Dependencies } from "../documents/context";
