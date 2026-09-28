import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { RuntimePorts } from "./runtime";
import { registerRoute } from "./routes";
import { versionItemSchema } from "./schemas";
import {
  uploadSchema,
  uploadResponseSchema,
  acceptDocumentSchema,
  rejectDocumentSchema,
} from "./document-schemas";
import {
  createDocument,
  checkDocument,
  acceptDocument,
  rejectDocument,
} from "./document-commands";
export function registerDocumentRoutes(
  app: OpenAPIHono,
  root: "owner" | "property",
  ports?: RuntimePorts,
): void {
  const path =
    root === "owner" ? "/{ownerId}/documents" : "/{propertyId}/documents";
  const base = {
    root,
    capability:
      root === "owner"
        ? ("identity_documents" as const)
        : ("properties_units" as const),
    write: true,
    roles: ["manager"] as const,
  };
  registerRoute(
    app,
    {
      method: "post",
      path,
      body: uploadSchema,
      response: uploadResponseSchema,
      operation: {
        ...base,
        command: `${root}.document_create`,
        execute: (scope, body) => createDocument(scope, body),
      },
    },
    ports,
  );
  const versionPath = `${path}/{documentId}/versions/{versionId}`;
  registerRoute(
    app,
    {
      method: "post",
      path: `${versionPath}/check`,
      body: z.object({}).strict(),
      response: z.object({
        version: versionItemSchema,
        scanPending: z.boolean(),
      }),
      operation: {
        ...base,
        command: `${root}.document_check`,
        execute: (scope, body) => checkDocument(scope, body),
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "post",
      path: `${versionPath}/accept`,
      body: acceptDocumentSchema,
      response: z.object({ version: versionItemSchema }),
      operation: {
        ...base,
        command: `${root}.document_accept`,
        execute: acceptDocument,
      },
    },
    ports,
  );
  registerRoute(
    app,
    {
      method: "post",
      path: `${versionPath}/reject`,
      body: rejectDocumentSchema,
      response: z.object({ version: versionItemSchema }),
      operation: {
        ...base,
        command: `${root}.document_reject`,
        execute: rejectDocument,
      },
    },
    ports,
  );
}
