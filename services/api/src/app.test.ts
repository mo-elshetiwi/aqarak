import { createRoute, z } from "@hono/zod-openapi";
import { describe, it, expect } from "vitest";
import { app, createApp } from "./app";
import { getOpenApiDocument } from "./openapi";

describe("HTTP contract", () => {
  it("returns a problem document when request validation fails", async () => {
    const application = createApp();
    const validationFixture = createRoute({
      method: "get",
      path: "/validation-fixture",
      request: { query: z.object({ value: z.string().min(1) }) },
      responses: { 200: { description: "Valid synthetic request." } },
    });
    application.openapi(validationFixture, (context) =>
      context.body(null, 200),
    );

    const response = await application.request("/validation-fixture");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "The request does not match the required schema.",
    });
  });
  it("answers health requests with the JSON availability contract", async () => {
    const response = await app.request("/v1/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });
  it("answers unknown paths with a problem document", async () => {
    const response = await app.request("/missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
    });
  });
  it("publishes only the health path", () => {
    expect(Object.keys(getOpenApiDocument().paths ?? {})).toEqual([
      "/v1/health",
    ]);
  });
  it("publishes the health route in OpenAPI 3.1", () => {
    const document = getOpenApiDocument();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/v1/health");
  });
});
