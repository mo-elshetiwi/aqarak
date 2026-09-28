import { app } from "./app";
/** Generates the published OpenAPI 3.1 health contract from route schemas. */
export function getOpenApiDocument(): ReturnType<
  typeof app.getOpenAPI31Document
> {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Aqarak API", version: "0.1.0" },
  });
}
