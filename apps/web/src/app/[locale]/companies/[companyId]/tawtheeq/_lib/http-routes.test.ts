import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { TawtheeqClient } from "./client";
import { createHttpClient } from "./http-client";
import type { AuditClient } from "../../audit/_lib/client";
import { createAuditHttpClient } from "../../audit/_lib/http-client";

const origin = "http://localhost:4000";
const company = "61000000-0000-4000-8000-000000000001";
const record = "65000000-0000-4000-8000-000000000001";
const document = "66000000-0000-4000-8000-000000000001";
const key = "synthetic-key";
const expected = { expectedVersion: 1 };
interface Route<Client> {
  method: "GET" | "POST";
  path: string;
  call: (client: Client) => Promise<unknown>;
}
const tawtheeqRoutes = {
  listRecords: { method: "GET", path: "", call: (c) => c.listRecords() },
  getRecord: {
    method: "GET",
    path: `/${record}`,
    call: (c) => c.getRecord(record),
  },
  getDocumentUrl: {
    method: "GET",
    path: `/${record}/document-url`,
    call: (c) => c.getDocumentUrl(record),
  },
  attestPortal: {
    method: "POST",
    path: `/${record}/attest-portal`,
    call: (c) => c.attestPortal(record, expected, key),
  },
  requestUpload: {
    method: "POST",
    path: `/${record}/uploads`,
    call: (c) =>
      c.requestUpload(
        record,
        {
          fileName: "synthetic.png",
          contentType: "image/png",
          byteSize: 4,
          sha256: "a".repeat(64),
        },
        key,
      ),
  },
  completeUpload: {
    method: "POST",
    path: `/${record}/uploads/${document}/complete`,
    call: (c) => c.completeUpload(record, document, expected, key),
  },
  runExtraction: {
    method: "POST",
    path: `/${record}/extraction`,
    call: (c) => c.runExtraction(record, key),
  },
  submitReview: {
    method: "POST",
    path: `/${record}/review`,
    call: (c) =>
      c.submitReview(
        record,
        {
          ...expected,
          documentVersionId: document,
          extractionId: null,
          fields: {
            tawtheeq_number: { value: "synthetic", provenance: "manual" },
            registered_on: { value: "2026-09-28", provenance: "manual" },
            unt_number: { value: "synthetic", provenance: "manual" },
            owner_id_number: { value: "synthetic", provenance: "manual" },
            tenant_id_number: { value: "synthetic", provenance: "manual" },
          },
        },
        key,
      ),
  },
  submitResolutions: {
    method: "POST",
    path: `/${record}/resolutions`,
    call: (c) =>
      c.submitResolutions(
        record,
        {
          ...expected,
          choices: [
            {
              discrepancyId: document,
              kind: "adopt",
              reason: "Synthetic reason",
            },
          ],
        },
        key,
      ),
  },
  portalReturn: {
    method: "POST",
    path: `/${record}/portal-return`,
    call: (c) =>
      c.portalReturn(record, { ...expected, reason: "Synthetic reason" }, key),
  },
  skip: {
    method: "POST",
    path: `/${record}/skip`,
    call: (c) =>
      c.skip(record, { ...expected, reason: "Synthetic reason" }, key),
  },
  resume: {
    method: "POST",
    path: `/${record}/resume`,
    call: (c) => c.resume(record, expected, key),
  },
  ownerReapproval: {
    method: "POST",
    path: `/${record}/owner-reapproval`,
    call: (c) =>
      c.ownerReapproval(record, { ...expected, decision: "approve" }, key),
  },
  skipConfirmation: {
    method: "POST",
    path: `/${record}/skip-confirmation`,
    call: (c) => c.skipConfirmation(record, { decision: "approve" }, key),
  },
} satisfies Record<keyof TawtheeqClient, Route<TawtheeqClient>>;
const auditRoutes = {
  events: {
    method: "GET",
    path: "/events?refusalsOnly=true",
    call: (c) => c.events({ refusalsOnly: "true" }),
  },
  versions: {
    method: "GET",
    path: `/subjects/tawtheeq_record/${record}/versions`,
    call: (c) => c.versions("tawtheeq_record", record),
  },
  verify: { method: "POST", path: "/verification", call: (c) => c.verify(key) },
  anchor: { method: "POST", path: "/anchors", call: (c) => c.anchor(key) },
  exportCsv: {
    method: "GET",
    path: "/export.csv?refusalsOnly=true",
    call: (c) => c.exportCsv({ refusalsOnly: "true" }),
  },
} satisfies Record<keyof AuditClient, Route<AuditClient>>;

describe("AC-1 API route table", () => {
  it.each(Object.entries(tawtheeqRoutes))(
    "Tawtheeq %s matches the API route exactly",
    async (_, route) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 }));
      await route.call(
        createHttpClient(`${origin}/`, company, "synthetic", transport),
      );
      expect(
        transport.mock.calls.map(([url, init]) => [init?.method, url]),
      ).toEqual([
        [
          route.method,
          `${origin}/v1/companies/${company}/tawtheeq${route.path}`,
        ],
      ]);
    },
  );
  it.each(Object.entries(auditRoutes))(
    "audit %s matches the API route exactly",
    async (_, route) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 }));
      await route.call(
        createAuditHttpClient(`${origin}/`, company, "synthetic", transport),
      );
      expect(
        transport.mock.calls.map(([url, init]) => [init?.method, url]),
      ).toEqual([
        [route.method, `${origin}/v1/companies/${company}/audit${route.path}`],
      ]);
    },
  );
});
