import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
} from "@aws-sdk/client-s3";
import { withCompanyTx, type CompanyTransaction } from "@aqarak/db";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { z } from "zod";
import { seed, type Seed, type SeedOptions, type SeedRole } from "./seed";
import { kernelDependenciesFromEnvironment } from "../../audit/kernel";
import { loadModelRegistry } from "../../../models/registry";
import { tawtheeqApplication } from "../index";
import type { TawtheeqDependencies } from "../dependencies";
import { rows, number, jsonValue } from "../storage";
import type { ReviewFields } from "../schemas";
export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
export const viewSchema = z.object({
  id: z.uuid(),
  version: z.number(),
  workflowState: z.string(),
  portalStatus: z.string(),
  tawtheeqNumber: z.string().nullable(),
  registeredOn: z.string().nullable(),
  attestedOn: z.string().nullable(),
  skipReason: z.string().nullable(),
  returnReason: z.string().nullable(),
  contract: z.object({
    currentVersionId: z.uuid(),
    annualRentFils: z.number(),
    owner: z.object({ idNumberMasked: z.string().nullable() }),
    tenant: z.object({ idNumberMasked: z.string().nullable() }),
  }),
  document: z
    .object({
      documentVersionId: z.uuid(),
      processingStatus: z.string(),
      reviewStatus: z.string(),
      rejectReason: z.string().nullable(),
    })
    .nullable(),
  comparison: z.array(z.object({ field: z.string(), status: z.string() })),
  discrepancies: z.array(
    z.object({
      id: z.uuid(),
      field: z.string(),
      class: z.string(),
      contractValue: z.unknown(),
      registeredValue: z.unknown(),
      status: z.string(),
    }),
  ),
  adoption: z
    .object({
      contractVersionId: z.uuid(),
      contentHash: z.string(),
      ownerApproval: z
        .object({ status: z.string(), reason: z.string().nullable() })
        .nullable(),
    })
    .nullable(),
  allowedActions: z.array(z.string()),
});
export type View = z.infer<typeof viewSchema>;
export interface Fixture extends Seed {
  activeTransactions: Set<string>;
  deps: Omit<TawtheeqDependencies, "gateway"> & {
    gateway: TawtheeqDependencies["gateway"];
  };
  request(
    suffix: string,
    body?: unknown,
    role?: SeedRole,
    key?: string,
  ): Promise<Response>;
  view(role?: SeedRole): Promise<View>;
  post(suffix: string, body: unknown, role?: SeedRole): Promise<View>;
  tx<T>(fn: (tx: CompanyTransaction) => Promise<T>): Promise<T>;
  events(): Promise<
    {
      event_type: string;
      subject_type: string;
      subject_id: string;
      reason: string | null;
      details: unknown;
      initiator: string;
      channel: string;
      seq: number;
    }[]
  >;
  upload(
    tag?: string | null,
  ): Promise<{ view: View; documentVersionId: string; response: Response }>;
}
export async function createFixture(
  options: SeedOptions = {},
): Promise<Fixture> {
  if (
    !["aqarak_tawtheeq", "aqarak_integration"].includes(
      process.env.DATABASE_NAME ?? "",
    )
  )
    throw new Error(
      "Integration tests require the isolated Tawtheeq database.",
    );
  const kernel = kernelDependenciesFromEnvironment(process.env);
  const data = await seed(kernel.database, options);
  const activeTransactions = new Set<string>();
  const track = (executor: DataApiExecutor): DataApiExecutor => ({
    ...executor,
    async execute(sql, parameters, transactionId) {
      try {
        return await executor.execute(sql, parameters, transactionId);
      } catch (error) {
        process.stderr.write(
          `Synthetic fixture database failure: ${error instanceof Error ? error.message : "Unknown database error"}\n`,
        );
        throw error;
      }
    },
    async begin() {
      const id = await executor.begin();
      activeTransactions.add(id);
      return id;
    },
    async commit(id) {
      await executor.commit(id);
      activeTransactions.delete(id);
    },
    async rollback(id) {
      await executor.rollback(id);
      activeTransactions.delete(id);
    },
  });
  const deps: TawtheeqDependencies = {
    ...kernel,
    database: track(kernel.database),
    pipelineDatabase: kernel.pipelineDatabase
      ? track(kernel.pipelineDatabase)
      : null,
    keyPrefix: "test/tawtheeq/",
    registry: loadModelRegistry(),
    gateway: null,
    authenticator: {
      authenticate(headers) {
        const auth = headers.get("Authorization");
        const entry = Object.entries(data.sessions).find(
          ([, value]) => auth === `Session ${value}`,
        );
        return Promise.resolve(
          entry ? { accountId: data.accounts[entry[0] as SeedRole] } : null,
        );
      },
    },
  };
  const app = tawtheeqApplication(deps);
  const fixture: Fixture = {
    ...data,
    activeTransactions,
    deps,
    async request(suffix, body, role = "manager", key = randomUUID()) {
      return app.request(`/v1/companies/${data.companyId}/tawtheeq${suffix}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Session ${data.sessions[role]}`,
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
    async view(role = "manager") {
      const response = await fixture.request(
        `/${data.recordId}`,
        undefined,
        role,
      );
      if (!response.ok)
        throw new Error(
          `Detail ${String(response.status)}: ${await response.text()}`,
        );
      return viewSchema.parse(await response.json());
    },
    async post(suffix, body, role = "manager") {
      const response = await fixture.request(
        `/${data.recordId}/${suffix}`,
        body,
        role,
      );
      if (!response.ok)
        throw new Error(
          `${suffix} ${String(response.status)}: ${await response.text()}`,
        );
      return viewSchema.parse(await response.json());
    },
    tx(fn) {
      return withCompanyTx(
        deps.database,
        { companyId: data.companyId, accountId: data.accounts.manager },
        fn,
      );
    },
    events() {
      return fixture.tx((tx) =>
        rows(
          tx,
          "select event_type,subject_type,subject_id,reason,details,initiator,channel,seq from audit.audit_event where company_id=:company::uuid order by seq",
          z.object({
            event_type: z.string(),
            subject_type: z.string(),
            subject_id: z.uuid(),
            reason: z.string().nullable(),
            details: jsonValue.nullable(),
            initiator: z.string(),
            channel: z.string(),
            seq: number,
          }),
          { company: data.companyId },
        ),
      );
    },
    async upload(tag = "NO_THREATS_FOUND") {
      const presign = await fixture.request(`/${data.recordId}/uploads`, {
        fileName: "synthetic.png",
        contentType: "image/png",
        byteSize: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      });
      const value = z
        .object({
          documentVersionId: z.uuid(),
          upload: z.object({
            url: z.string(),
            headers: z.record(z.string(), z.string()),
          }),
        })
        .parse(await presign.json());
      const put = await fetch(value.upload.url, {
        method: "PUT",
        headers: value.upload.headers,
        body: png,
      });
      if (!put.ok)
        throw new Error(`Synthetic PUT failed: ${String(put.status)}`);
      const pinned = {
        Bucket: deps.buckets.documents ?? "",
        Key: `${deps.keyPrefix}companies/${data.companyId}/tawtheeq/${data.recordId}/${value.documentVersionId}`,
        VersionId: put.headers.get("x-amz-version-id") ?? undefined,
      };
      // I wait for the real scanner before overriding synthetic scan evidence, so it cannot overwrite the test tag.
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const scanned = await deps.s3.send(new GetObjectTaggingCommand(pinned));
        if (
          scanned.TagSet?.some(
            (entry) => entry.Key === "GuardDutyMalwareScanStatus",
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await deps.s3.send(
        new PutObjectTaggingCommand({
          ...pinned,
          Tagging: {
            TagSet: tag
              ? [{ Key: "GuardDutyMalwareScanStatus", Value: tag }]
              : [],
          },
        }),
      );
      const [before] = await fixture.tx((tx) =>
        rows(
          tx,
          "select version from lease.tawtheeq_record where company_id=:company::uuid and id=:id::uuid",
          z.object({ version: number }),
          { company: data.companyId, id: data.recordId },
        ),
      );
      if (!before) throw new Error("Expected seeded record");
      const response = await fixture.request(
        `/${data.recordId}/uploads/${value.documentVersionId}/complete`,
        { expectedVersion: before.version },
      );
      return {
        view: response.ok
          ? viewSchema.parse(await response.clone().json())
          : await fixture.view(),
        documentVersionId: value.documentVersionId,
        response,
      };
    },
  };
  return fixture;
}
export function confirmedFields(rent = 22000000): ReviewFields {
  return {
    tawtheeq_number: { value: "SYNTHETIC-2026-711", provenance: "manual" },
    registered_on: { value: "2026-08-14", provenance: "manual" },
    unt_number: { value: "711", provenance: "manual" },
    owner_id_number: { value: "784000000000001", provenance: "manual" },
    tenant_id_number: { value: "784196400029904", provenance: "manual" },
    term_start: { value: "2026-08-13", provenance: "manual" },
    term_end: { value: "2027-08-12", provenance: "manual" },
    annual_rent_fils: { value: rent, provenance: "manual" },
    deposit_fils: { value: 2030000, provenance: "manual" },
    contract_type: { value: "RESIDENTIAL", provenance: "manual" },
    owner_name: { value: "Omar Al Nuaimi", provenance: "manual" },
    tenant_name: { value: "Mohammed Farouk", provenance: "manual" },
  };
}
export async function reviewed(
  fixture: Fixture,
  fields: ReviewFields,
): Promise<View> {
  const uploaded = await fixture.upload();
  return fixture.post("review", {
    expectedVersion: uploaded.view.version,
    documentVersionId: uploaded.documentVersionId,
    extractionId: null,
    fields,
  });
}
