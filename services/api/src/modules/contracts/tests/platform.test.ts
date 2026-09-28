import { Hono } from "hono";
import { expect, it } from "vitest";

it("resolves the company parameter inside mounted routes", async () => {
  const app = new Hono();
  const routes = new Hono();
  routes.get("/", (c) => c.json({ companyId: c.req.param("companyId") }));
  app.route("/v1/companies/:companyId/contracts", routes);
  const response = await app.request("/v1/companies/company-value/contracts");
  expect(await response.json()).toEqual({ companyId: "company-value" });
});
