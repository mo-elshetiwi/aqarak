import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { version } from "../../package.json";
import { app } from "../app";
import { apiModules, validateApiModules, type ApiModule } from "./index";

afterEach(() => vi.unstubAllEnvs());

describe("API module registry", () => {
  it.each(["dev", "dev"])(
    "returns the package version and %s stage through the mounted system module",
    async (stage) => {
      vi.stubEnv("STAGE", stage);
      const response = await app.request("/v1/system/version");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ version, stage });
    },
  );

  it("uses the local stage when STAGE is absent", async () => {
    vi.stubEnv("STAGE", undefined);
    const response = await app.request("/v1/system/version");
    expect(await response.json()).toEqual({ version, stage: "local" });
  });

  it.each(["/v1/system", "/v1/system/"])(
    "rejects a duplicate base path %s before registration",
    (basePath) => {
      const duplicate: ApiModule = {
        name: "duplicate",
        basePath,
        register: vi.fn(),
      };
      expect(() => validateApiModules([...apiModules, duplicate])).toThrow(
        'Duplicate API module base path "/v1/system": "system" and "duplicate"',
      );
      expect(duplicate.register).not.toHaveBeenCalled();
    },
  );

  it("accepts distinct module paths and registers relative routes", async () => {
    const modules = validateApiModules([
      ...apiModules,
      {
        name: "fixture",
        basePath: "/v1/fixture",
        register: (routes: Hono) => {
          routes.get("/ready", (context) => context.json({ ready: true }));
        },
      },
    ]);
    const application = new Hono();
    for (const module of modules) {
      const routes = new Hono();
      module.register(routes);
      application.route(module.basePath, routes);
    }
    expect((await application.request("/v1/fixture/ready")).status).toBe(200);
    expect((await application.request("/v1/system/version")).status).toBe(200);
    expect((await application.request("/ready")).status).toBe(404);
  });
});
