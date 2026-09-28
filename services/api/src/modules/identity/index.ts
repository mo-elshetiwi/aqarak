import type { ApiModule } from "../index";
import { invitationRoutes } from "./invitation-routes";
import { authRoutes } from "./auth-routes";
import type { DependencySource } from "./ports";
import { runtimeDependencies } from "./runtime";
export {
  authenticate,
  resolvePrincipal,
  requireCompanyActor,
  authorize,
  recordDenial,
  commandTx,
} from "./guard";
export type {
  Principal,
  IdentityVariables,
  IdentityContext,
  RoutePermission,
} from "./guard";
export { withIdempotency } from "./database";
export type { Dependencies, IdentityProvider, EmailSender } from "./ports";
export function createIdentityModule(source: DependencySource): ApiModule {
  return {
    name: "identity",
    basePath: "/v1",
    register(app) {
      app.route("/", authRoutes(source));
      app.route("/", invitationRoutes(source));
    },
  };
}
export const identityModule = createIdentityModule(runtimeDependencies);
