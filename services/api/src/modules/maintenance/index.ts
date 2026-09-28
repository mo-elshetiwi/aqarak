import type { ApiModule } from "..";
import { createMediaModule } from "../media";
import { createRuntime, type MaintenanceDependencies } from "./runtime";
import { decideIntake } from "./intake-decisions";
import { createIntake, getIntake } from "./intake-draft";
import { ticket, tickets, units } from "./reads";

export type { Authenticator } from "./auth";
export type { MaintenanceDependencies } from "./runtime";
export function createMaintenanceModules(
  deps?: MaintenanceDependencies,
): readonly [ApiModule, ApiModule] {
  const runtime = createRuntime(deps);
  const maintenance: ApiModule = {
    name: "maintenance",
    basePath: "/v1/companies/:companyId/maintenance",
    register(app) {
      for (const decision of ["confirm", "reject"] as const)
        app.post(`/intakes/:intakeId/${decision}`, (c) =>
          runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
            decideIntake(runtime, scope, c.req.raw, {
              intakeId: c.req.param("intakeId"),
              decision,
            }),
          ),
        );

      app.post("/intakes", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          createIntake(runtime, scope, c.req.raw),
        ),
      );
      app.get("/intakes/:intakeId", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          getIntake(runtime, scope, c.req.param("intakeId")),
        ),
      );
      app.get("/units", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          units(runtime, scope),
        ),
      );
      app.get("/tickets", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          tickets(runtime, scope, c.req.raw),
        ),
      );
      app.get("/tickets/:ticketId", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          ticket(runtime, scope, c.req.param("ticketId")),
        ),
      );
    },
  };
  return [createMediaModule(runtime), maintenance];
}
