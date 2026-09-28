import { authenticateRequest } from "../identity/adapters";
import type { ApiModule } from "..";
import {
  type J3Dependencies,
  type AccountAuthenticator,
  authorize,
} from "./context";
import { lazyDependencies } from "./dependencies";
import { routeHandler, emptyBody } from "./http";
import {
  requestUpload,
  uploadSchema,
  completeUpload,
  content,
  rejectVersion,
  rejectionSchema,
} from "./commands";
import { loadVersion, versionDetail } from "./read";
import { str } from "./sql";
import { decideField, decisionSchema } from "./review";
import { extractDocument } from "../extraction/command";

function moduleFor(
  authenticate: AccountAuthenticator,
  resolve: () => J3Dependencies,
): ApiModule {
  const version = "/:documentId/versions/:versionId";
  return {
    name: "documents",
    basePath: "/v1/companies/:companyId/documents",
    register(app) {
      app.post(
        "/",
        routeHandler(authenticate, resolve, {
          command: "document.upload",
          authorize: (ctx, body) => {
            authorize(ctx, {
              operation: "write",
              capability: "identity_documents",
              tenant: body.subjectId,
            });
          },
          schema: uploadSchema,
          run: requestUpload,
        }),
      );
      app.post(
        `${version}/upload-complete`,
        routeHandler(authenticate, resolve, {
          command: "document.upload_complete",
          authorize: async (ctx) => {
            await loadVersion(ctx, "write");
          },
          schema: emptyBody,
          run: completeUpload,
        }),
      );
      app.post(
        `${version}/extraction`,
        routeHandler(authenticate, resolve, {
          command: "document.extraction",
          authorize: async (ctx) => {
            await loadVersion(ctx, "write");
          },
          schema: emptyBody,
          run: extractDocument,
        }),
      );
      app.get(
        version,
        routeHandler(authenticate, resolve, {
          schema: emptyBody,
          async run(ctx) {
            const row = await loadVersion(ctx);
            return {
              status: 200,
              body: { version: await versionDetail(ctx, str(row, "id")) },
            };
          },
        }),
      );
      app.get(
        `${version}/content`,
        routeHandler(authenticate, resolve, {
          schema: emptyBody,
          run: content,
        }),
      );
      app.put(
        `${version}/fields/:fieldName`,
        routeHandler(authenticate, resolve, {
          command: "document.field_review",
          authorize: async (ctx) => {
            await loadVersion(ctx, "write", true);
          },
          schema: decisionSchema,
          run: decideField,
        }),
      );
      app.post(
        `${version}/reject`,
        routeHandler(authenticate, resolve, {
          command: "document.reject",
          authorize: async (ctx) => {
            await loadVersion(ctx, "write", true);
          },
          schema: rejectionSchema,
          run: rejectVersion,
        }),
      );
    },
  };
}
export function createDocumentsModule(deps: J3Dependencies): ApiModule {
  return moduleFor(deps.authenticate, () => deps);
}
export const documentsModule: ApiModule = moduleFor(
  authenticateRequest,
  lazyDependencies(),
);
export type { J3Dependencies, AccountAuthenticator } from "./context";
export type { DocumentStorage } from "./storage";
