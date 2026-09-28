import { getConfig } from "../config";
import { authenticateRequest } from "./identity/adapters";
import { audit } from "./audit";
import { tawtheeqModule } from "./tawtheeq";
import { identityModule } from "./identity";
import { companiesModule } from "./companies";
import { createMaintenanceModules } from "./maintenance";
import type { Hono } from "hono";
import { ownersModule } from "./owners";
import { propertiesModule } from "./properties";
import { tenantsModule, documentsModule } from "./tenants";
import { createWorkflowModules } from "./contracts/workflows";
import { version } from "../../package.json";

export interface ApiModule {
  readonly name: string;
  readonly basePath: string;
  readonly register: (app: Hono) => void;
}

export function validateApiModules(
  modules: readonly ApiModule[],
): readonly ApiModule[] {
  const paths = new Map<string, string>();
  for (const module of modules) {
    const basePath = module.basePath.replace(/\/+$/, "") || "/";
    const existing = paths.get(basePath);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate API module base path "${basePath}": "${existing}" and "${module.name}"`,
      );
    }
    paths.set(basePath, module.name);
  }
  return modules;
}

const system: ApiModule = {
  name: "system",
  basePath: "/v1/system",
  register(application) {
    application.get("/version", (context) =>
      context.json({ version, stage: getConfig().STAGE }),
    );
  },
};

const [media, maintenance] = createMaintenanceModules();
export const apiModules: readonly ApiModule[] = validateApiModules([
  system,
  audit,
  tawtheeqModule,
  identityModule,
  companiesModule,
  ownersModule,
  propertiesModule,
  tenantsModule,
  documentsModule,
  ...createWorkflowModules({ authenticate: authenticateRequest }),
  media,
  maintenance,
]);
