import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { z } from "zod";
import { createTenantsModule } from ".";
import { createDocumentsModule } from "../documents";
import { createProductionDependencies } from "../documents/dependencies";
import { withCompanyTx } from "../documents/database";
import { rows, str, num } from "../documents/sql";
import { sniffContentType } from "../documents/domain";
import { catalogue } from "../extraction/fields";
import { seedDemoManager } from "./fixture-seed";
import { goldDecision, smokeEnabled } from "./smoke-support";

const objectSchema = z.record(z.string(), z.unknown());
const versionSchema = z.object({
  processingStatus: z.enum(["extracted", "extraction_failed"]),
  fields: z
    .array(
      z.object({
        name: z.enum(catalogue.map(({ name }) => name)),
        suggestedValue: z.string().nullable(),
        category: z.enum(["confirm", "check"]),
        requiresSourceCheck: z.boolean(),
      }),
    )
    .nullable(),
  modelCall: z
    .object({
      status: z.enum(["succeeded", "failed"]),
      latencyMs: z.number(),
      registryEntry: z.string(),
      promptVersion: z.string(),
    })
    .nullable(),
});
interface Step {
  readonly step: string;
  readonly status: number;
  readonly code: string;
  readonly ms: number;
}
interface Summary {
  readonly steps: Step[];
  extraction: {
    processingStatus: string;
    modelCallStatus: string | null;
    latencyMs: number | null;
    registryEntry: string | null;
    promptVersion: string | null;
    fields: number;
    confirm: number;
    check: number;
    requiresSourceCheck: number;
    nullSuggestions: number;
  } | null;
  readonly decisions: {
    accepted: number;
    edited: number;
    notOnDocument: number;
  };
  identityStatus: string | null;
  chainOk: boolean;
  events: Record<string, number>;
  readonly companyId: string;
}
class SmokeFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new SmokeFailure(0, "ROOT_NOT_FOUND");
    directory = parent;
  }
  return directory;
}
function loadImage(): {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/jpeg" | "image/png";
  fileName: string;
  gold: Record<string, { value: string | null }>;
} {
  const root = repositoryRoot();
  const dataset = resolve(root, "evaluation/datasets/synthetic-docs-v1");
  const imagePath = resolve(
    root,
    process.env.J3_SMOKE_IMAGE ??
      "evaluation/datasets/synthetic-docs-v1/images/emirates_id-005.jpg",
  );
  const bytes = new Uint8Array(readFileSync(imagePath));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const labelSchema = z.object({
    kind: z.string(),
    synthetic: z.boolean(),
    image: z.string(),
    image_sha256: z.string(),
    fields: z.record(z.string(), z.object({ value: z.string().nullable() })),
  });
  const labels = readFileSync(resolve(dataset, "labels.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => labelSchema.parse(JSON.parse(line)));
  const label = labels.find((item) => item.image_sha256 === digest);
  if (!label || !label.synthetic || label.kind !== "emirates_id")
    throw new SmokeFailure(0, "SYNTHETIC_GOLD_MISSING");
  const contentType = sniffContentType(bytes);
  if (contentType !== "image/jpeg" && contentType !== "image/png")
    throw new SmokeFailure(0, "IMAGE_TYPE_INVALID");
  return {
    bytes,
    contentType,
    fileName: basename(imagePath),
    gold: label.fields,
  };
}
function responseCode(body: Record<string, unknown>): string {
  const known = [
    "SCAN_PENDING",
    "SCAN_REJECTED",
    "UNAVAILABLE",
    "EXTRACTION_UNAVAILABLE",
    "UPLOAD_MISSING",
    "UPLOAD_MISMATCH",
    "INVALID_STATE",
    "FIELD_INVALID",
    "FIELD_REQUIRED",
    "REVIEW_INCOMPLETE",
    "STALE_VERSION",
    "NOT_FOUND",
    "VALIDATION_FAILED",
    "SESSION_INVALID",
  ];
  return typeof body.code === "string" && known.includes(body.code)
    ? body.code
    : "REQUEST_FAILED";
}

function extractionSummary(
  version: z.infer<typeof versionSchema>,
): Summary["extraction"] {
  const fields = version.fields ?? [];
  return {
    processingStatus: version.processingStatus,
    modelCallStatus: version.modelCall?.status ?? null,
    latencyMs: version.modelCall?.latencyMs ?? null,
    registryEntry: version.modelCall?.registryEntry ?? null,
    promptVersion: version.modelCall?.promptVersion ?? null,
    fields: fields.length,
    confirm: fields.filter((field) => field.category === "confirm").length,
    check: fields.filter((field) => field.category === "check").length,
    requiresSourceCheck: fields.filter((field) => field.requiresSourceCheck)
      .length,
    nullSuggestions: fields.filter((field) => field.suggestedValue === null)
      .length,
  };
}

export async function runSmoke(): Promise<{
  summary: Summary;
  exitCode: number;
}> {
  const companyId = randomUUID();
  const accountId = randomUUID();
  const summary: Summary = {
    steps: [],
    extraction: null,
    decisions: { accepted: 0, edited: 0, notOnDocument: 0 },
    identityStatus: null,
    chainOk: false,
    events: {},
    companyId,
  };
  async function measure<T>(
    step: string,
    action: () => Promise<{ status: number; value: T }>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await action();
      summary.steps.push({
        step,
        status: result.status,
        code: "OK",
        ms: Math.round(performance.now() - start),
      });
      return result.value;
    } catch (error) {
      summary.steps.push({
        step,
        status: error instanceof SmokeFailure ? error.status : 0,
        code: error instanceof SmokeFailure ? error.code : "STEP_FAILED",
        ms: Math.round(performance.now() - start),
      });
      throw error;
    }
  }
  try {
    const { deps, image } = await measure("prepare", () => {
      const image = loadImage();
      const deps = createProductionDependencies();
      return Promise.resolve({ status: 200, value: { deps, image } });
    });
    const context = { companyId, accountId };
    await measure("seed", async () => {
      await withCompanyTx(deps.appExecutor, context, (tx) =>
        seedDemoManager(tx, {
          company: companyId,
          account: accountId,
          companyName: `J3 smoke company ${new Date().toISOString()}`,
          email: `j3-smoke-${accountId}@example.com`,
        }),
      );
      return { status: 201, value: undefined };
    });
    const scoped = {
      ...deps,
      authenticate: () => Promise.resolve({ accountId }),
    };
    const app = new Hono();
    app.onError(
      () =>
        new Response(JSON.stringify({ code: "UNAVAILABLE" }), { status: 503 }),
    );
    for (const module of [
      createTenantsModule(scoped),
      createDocumentsModule(scoped),
    ]) {
      const child = new Hono();
      module.register(child);
      app.route(module.basePath, child);
    }
    async function send(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = await app.request(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      return {
        status: response.status,
        body: objectSchema.parse(await response.json()),
      };
    }
    function checked(reply: {
      status: number;
      body: Record<string, unknown>;
    }): { status: number; value: Record<string, unknown> } {
      if (reply.status < 200 || reply.status >= 300)
        throw new SmokeFailure(reply.status, responseCode(reply.body));
      return { status: reply.status, value: reply.body };
    }
    async function request(
      step: string,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<Record<string, unknown>> {
      return measure(step, async () => checked(await send(method, path, body)));
    }
    const base = `/v1/companies/${companyId}`;
    const created = await request("create_tenant", "POST", `${base}/tenants`, {
      kind: "individual",
      fullNameEn: "Smoke Tenant",
      fullNameAr: "مستأجر تجريبي",
      email: `smoke-tenant-${randomUUID()}@example.com`,
      preferredLanguage: "en",
    });
    const tenant = z
      .object({ id: z.uuid(), version: z.number() })
      .parse(created.tenant);
    const tenantPath = `${base}/tenants/${tenant.id}`;
    await request("invite", "POST", `${tenantPath}/invitations`);
    const upload = await request(
      "request_upload",
      "POST",
      `${base}/documents`,
      {
        subjectType: "tenant",
        subjectId: tenant.id,
        docType: "emirates_id",
        fileName: image.fileName,
        contentType: image.contentType,
        byteSize: image.bytes.length,
        sha256: createHash("sha256").update(image.bytes).digest("hex"),
        uploadedVia: "web",
      },
    );
    const documentId = z.object({ id: z.uuid() }).parse(upload.document).id;
    const versionId = z.object({ id: z.uuid() }).parse(upload.version).id;
    const presigned = z
      .object({ url: z.url(), headers: z.record(z.string(), z.string()) })
      .parse(upload.upload);
    const versionPath = `${base}/documents/${documentId}/versions/${versionId}`;
    await measure("put_upload", async () => {
      const response = await fetch(presigned.url, {
        method: "PUT",
        headers: presigned.headers,
        body: image.bytes,
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new SmokeFailure(response.status, "UPLOAD_FAILED");
      return { status: response.status, value: undefined };
    });
    await request("complete_upload", "POST", `${versionPath}/upload-complete`);
    await measure("start_extraction", async () => {
      for (let attempt = 0; attempt <= 36; attempt += 1) {
        const reply = await send("POST", `${versionPath}/extraction`);
        if (
          reply.status !== 409 ||
          reply.body.code !== "SCAN_PENDING" ||
          attempt === 36
        )
          return checked(reply);
        await delay(5000);
      }
      throw new SmokeFailure(409, "SCAN_PENDING");
    });
    const version = versionSchema.parse(
      (await request("read_version", "GET", versionPath)).version,
    );
    const fields = version.fields ?? [];
    summary.extraction = extractionSummary(version);
    await measure("validate_extraction", () => {
      if (
        version.processingStatus !== "extracted" ||
        version.modelCall?.status !== "succeeded" ||
        fields.length !== catalogue.length ||
        new Set(fields.map((field) => field.name)).size !== catalogue.length
      )
        throw new SmokeFailure(0, "EXTRACTION_FAILED");
      return Promise.resolve({ status: 200, value: undefined });
    });
    await request("content_url", "GET", `${versionPath}/content`);
    for (const field of fields) {
      const decision = goldDecision(
        field.name,
        field.suggestedValue,
        image.gold[field.name]?.value,
      );
      await request(
        `decide_${field.name}`,
        "PUT",
        `${versionPath}/fields/${field.name}`,
        decision,
      );
      const key =
        decision.decision === "not_on_document"
          ? "notOnDocument"
          : decision.decision;
      summary.decisions[key] += 1;
    }
    await request("save_identity", "POST", `${tenantPath}/identity`, {
      documentVersionId: versionId,
      expectedTenantVersion: tenant.version,
    });
    const read = await request("read_tenant", "GET", tenantPath);
    summary.identityStatus = z
      .object({
        identityStatus: z.enum(["verified", "pending_review", "missing"]),
      })
      .parse(read.tenant).identityStatus;
    await measure("verify_chain", async () => {
      const chain = await withCompanyTx(deps.appExecutor, context, (tx) =>
        rows(tx, "select * from audit.verify_chain(cast(:company as uuid))", {
          company: companyId,
        }),
      );
      summary.chainOk = chain.length === 1 && chain[0]?.ok === true;
      if (!summary.chainOk) throw new SmokeFailure(0, "CHAIN_INVALID");
      return { status: 200, value: undefined };
    });
    await measure("count_events", async () => {
      const events = await withCompanyTx(deps.appExecutor, context, (tx) =>
        rows(
          tx,
          "select event_type,count(*) as count from audit.audit_event where company_id=cast(:company as uuid) group by event_type order by event_type",
          { company: companyId },
        ),
      );
      summary.events = Object.fromEntries(
        events.map((event) => [str(event, "event_type"), num(event, "count")]),
      );
      return { status: 200, value: undefined };
    });
    return {
      summary,
      exitCode:
        summary.identityStatus === "verified" && summary.chainOk ? 0 : 1,
    };
  } catch {
    if (summary.steps.at(-1)?.code === "OK")
      summary.steps.push({
        step: "validate_response",
        status: 0,
        code: "INVALID_RESPONSE",
        ms: 0,
      });
    return { summary, exitCode: 1 };
  }
}

export async function smokeMain(
  environment: NodeJS.ProcessEnv = process.env,
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
  journey: typeof runSmoke = runSmoke,
): Promise<number> {
  if (!smokeEnabled(environment)) {
    write(
      "J3 smoke refused: enable both smoke gates and configure the development database, bucket and model.\n",
    );
    return 2;
  }
  const result = await journey();
  write(`${JSON.stringify(result.summary)}\n`);
  return result.exitCode;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await smokeMain();
}
