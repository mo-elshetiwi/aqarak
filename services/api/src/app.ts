import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Hono } from "hono";
import { apiModules } from "./modules";
/** Creates an isolated HTTP boundary with structured request failures. */
export function createApp(): OpenAPIHono {
  const application = new OpenAPIHono({
    defaultHook: (result, context) => {
      if (!result.success) {
        return context.newResponse(
          JSON.stringify({
            type: "about:blank",
            title: "Bad Request",
            status: 400,
            detail: "The request does not match the required schema.",
          }),
          400,
          { "Content-Type": "application/problem+json" },
        );
      }
      return undefined;
    },
  });
  application.notFound((context) =>
    context.newResponse(
      JSON.stringify({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "The requested resource was not found.",
      }),
      404,
      { "Content-Type": "application/problem+json" },
    ),
  );
  return application;
}
/** HTTP boundary providing the health contract and structured request failures. */
export const app = createApp();
const healthSchema = z.object({ status: z.literal("ok") });
const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  responses: {
    200: {
      description: "The service is available.",
      content: { "application/json": { schema: healthSchema } },
    },
  },
});
app.openapi(healthRoute, (context) =>
  context.json(healthSchema.parse({ status: "ok" }), 200),
);
for (const module of apiModules) {
  const routes = new Hono();
  module.register(routes);
  app.route(module.basePath, routes);
}
