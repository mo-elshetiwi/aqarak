import { registerDocumentRoutes } from "./lib/document-routes";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { estateApp, registerRoute } from "./lib/routes";
import type { RuntimePorts } from "./lib/runtime";
import { paginationSchema } from "./lib/schemas";
import {
  createPropertySchema,
  updatePropertySchema,
  propertySummarySchema,
  propertyListItemSchema,
  propertyDetailSchema,
  bulkUnitsSchema,
  updateUnitSchema,
  unitItemSchema,
  unitStatusSchema,
} from "./schemas";
import {
  createProperty,
  editProperty,
  addUnits,
  editUnit,
  changeUnitStatus,
} from "./commands";
import { listProperties, propertyDetail } from "./read";
import { one } from "./lib/sql";
export function createPropertiesApp(ports?: RuntimePorts): OpenAPIHono {
  const app = estateApp();
  const base = {
    root: "property" as const,
    capability: "properties_units" as const,
  };
  const readers = [
    "manager",
    "company_administrator",
    "accountant",
    "owner",
    "tenant",
  ] as const;
  registerRoute(
    app,
    {
      method: "get",
      path: "/",
      query: paginationSchema,
      response: z.object({
        items: z.array(propertyListItemSchema),
        nextCursor: z.string().nullable(),
      }),
      operation: {
        ...base,
        command: "properties.list",
        write: false,
        roles: readers,
        execute: async (scope, _body, query) => ({
          status: 200,
          body: await listProperties(scope, query),
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
      body: createPropertySchema,
      response: z.object({ property: propertySummarySchema }),
      operation: {
        ...base,
        command: "property.create",
        write: true,
        roles: ["manager"],
        execute: createProperty,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "get",
      path: "/{propertyId}",
      response: propertyDetailSchema,
      operation: {
        ...base,
        command: "property.read",
        write: false,
        roles: readers,
        execute: async (scope) => ({
          status: 200,
          body: await propertyDetail(
            scope,
            one(scope.root ? [scope.root] : []),
          ),
        }),
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "patch",
      path: "/{propertyId}",
      body: updatePropertySchema,
      response: z.object({ property: propertySummarySchema }),
      operation: {
        ...base,
        command: "property.update",
        write: true,
        roles: ["manager"],
        execute: editProperty,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "post",
      path: "/{propertyId}/units",
      body: bulkUnitsSchema,
      response: z.object({ units: z.array(unitItemSchema) }),
      operation: {
        ...base,
        command: "property.units",
        write: true,
        roles: ["manager"],
        execute: addUnits,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "patch",
      path: "/{propertyId}/units/{unitId}",
      body: updateUnitSchema,
      response: z.object({ unit: unitItemSchema }),
      operation: {
        ...base,
        command: "unit.update",
        write: true,
        roles: ["manager"],
        execute: editUnit,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "post",
      path: "/{propertyId}/units/{unitId}/status",
      body: unitStatusSchema,
      response: z.object({ unit: unitItemSchema }),
      operation: {
        ...base,
        command: "unit.status",
        write: true,
        roles: ["manager"],
        execute: changeUnitStatus,
      },
    },
    ports,
  );
  registerDocumentRoutes(app, "property", ports);
  return app;
}
