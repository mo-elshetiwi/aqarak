import {
  OpenAPIHono,
  createRoute,
  z,
  type RouteHandler,
} from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { idempotencyKey } from "./domain";
import { EstateProblem, problemResponse, problemSchema } from "./problem";
import {
  runOperation,
  type RouteOperation,
  type RuntimePorts,
} from "./runtime";
export function estateApp(): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        return problemResponse(
          c,
          new EstateProblem(
            400,
            "VALIDATION_FAILED",
            issue?.path.map(String).join("."),
          ),
        );
      }
      return undefined;
    },
  });
  app.onError((cause, c) =>
    problemResponse(
      c,
      new EstateProblem(
        cause instanceof HTTPException && cause.status === 400 ? 400 : 503,
        cause instanceof HTTPException && cause.status === 400
          ? "VALIDATION_FAILED"
          : "UNAVAILABLE",
      ),
    ),
  );
  return app;
}
export function registerRoute(
  app: OpenAPIHono,
  route: {
    method: "get" | "post" | "put" | "patch";
    path: string;
    body?: z.ZodType;
    query?: z.ZodObject;
    response: z.ZodObject;
    operation: RouteOperation;
  },
  ports?: RuntimePorts,
): void {
  const params: Record<string, z.ZodUUID> = { companyId: z.uuid() };
  for (const match of route.path.matchAll(/\{(\w+)\}/g))
    if (match[1]) params[match[1]] = z.uuid();
  const headers = z.object({
    "idempotency-key": route.operation.write
      ? idempotencyKey
      : idempotencyKey.optional(),
    "x-aqarak-channel": z.enum(["web_form", "mobile_form"]).optional(),
  });
  const spec = createRoute({
    method: route.method,
    path: route.path,
    request: {
      params: z.object(params),
      headers,
      ...(route.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: route.body } },
            },
          }
        : {}),
      ...(route.query ? { query: route.query } : {}),
    },
    responses: {
      200: {
        description: "Read or updated record",
        content: { "application/json": { schema: route.response } },
      },
      201: {
        description: "Created record",
        content: { "application/json": { schema: route.response } },
      },
      400: {
        description: "Invalid request",
        content: { "application/problem+json": { schema: problemSchema } },
      },
      401: {
        description: "Identity required",
        content: { "application/problem+json": { schema: problemSchema } },
      },
      403: {
        description: "Not permitted",
        content: { "application/problem+json": { schema: problemSchema } },
      },
      404: {
        description: "Record unavailable",
        content: { "application/problem+json": { schema: problemSchema } },
      },
      409: {
        description: "State conflict",
        content: { "application/problem+json": { schema: problemSchema } },
      },
      422: {
        description: "Command refused",
        content: { "application/problem+json": { schema: problemSchema } },
      },
      503: {
        description: "Service unavailable",
        content: { "application/problem+json": { schema: problemSchema } },
      },
    },
  });
  // Dynamic registration uses the same validated response boundary for every declared route.
  const handler: RouteHandler<typeof spec> = (async (
    c: import("hono").Context,
  ) =>
    runOperation(
      c,
      route.operation,
      {
        body: route.body ? route.body.parse(await c.req.json<unknown>()) : null,
        query: route.query ? route.query.parse(c.req.query()) : {},
      },
      ports,
    )) as unknown as RouteHandler<typeof spec>;
  app.openapi(spec, handler);
}
