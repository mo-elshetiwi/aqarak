import type { ApiModule } from "..";
import type { Runtime } from "../maintenance/runtime";
import { completeUpload, downloadMedia, uploadSlot } from "./commands";

export function createMediaModule(runtime: Runtime): ApiModule {
  return {
    name: "media",
    basePath: "/v1/companies/:companyId/media",
    register(app) {
      app.post("/uploads", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          uploadSlot(runtime, scope, c.req.raw),
        ),
      );
      app.post("/:mediaId/complete", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          completeUpload(runtime, scope, c.req.raw, c.req.param("mediaId")),
        ),
      );
      app.get("/:mediaId/download", (c) =>
        runtime.handle(c.req.raw, c.req.param("companyId"), (scope) =>
          downloadMedia(runtime, scope, c.req.param("mediaId")),
        ),
      );
    },
  };
}
