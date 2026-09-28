import { createHash, randomUUID } from "node:crypto";
import { PutObjectTaggingCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFixture, png, type Fixture } from "./test-support/fixture";
import { rows, number, jsonValue } from "./storage";
const integration =
  process.env.AQARAK_INTEGRATION === "1" ? describe : describe.skip;
const active: Fixture[] = [];
async function fixture(
  options: Parameters<typeof createFixture>[0] = {},
): Promise<Fixture> {
  const f = await createFixture(options);
  active.push(f);
  return f;
}
afterEach(() => {
  for (const f of active.splice(0)) f.deps.s3.destroy();
});
async function problem(
  response: Response,
  status: number,
  code: string,
  domainCode?: string,
): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(status);
  expect(await response.json()).toMatchObject({
    code,
    ...(domainCode ? { domainCode } : {}),
  });
}
function route(f: Fixture, name: string): string {
  return `/${f.recordId}/${name}`;
}
integration(
  "Tawtheeq registration against the isolated database",
  { timeout: 180000 },
  () => {
    it("AC-1 attests and returns with one primary event each and a valid chain", async () => {
      const companyId = randomUUID();
      const f = await fixture({ companyId });
      expect(f.companyId).toBe(companyId);
      const before = (await f.events()).length;
      const attested = await f.post("attest-portal", { expectedVersion: 1 });
      expect(attested).toMatchObject({
        workflowState: "submitted_on_portal",
        portalStatus: "pending",
      });
      expect(attested.attestedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const returned = await f.post("portal-return", {
        expectedVersion: attested.version,
        reason: "Portal requested a correction",
      });
      expect(returned).toMatchObject({
        workflowState: "awaiting_registration",
        returnReason: "Portal requested a correction",
      });
      const events = (await f.events()).slice(before);
      expect(events.map((event) => event.event_type)).toEqual([
        "tawtheeq_record.submitted_on_portal",
        "tawtheeq_record.awaiting_registration",
      ]);
      expect(events[1]?.reason).toBe("Portal requested a correction");
      const uncovered = await f.tx((tx) =>
        rows(
          tx,
          "select count(*) as count from audit.entity_version v where company_id=:company::uuid and not exists(select 1 from audit.event_subject s where s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version)",
          z.object({ count: number }),
          { company: f.companyId },
        ),
      );
      expect(uncovered[0]?.count).toBe(0);
      const chain = await f.tx((tx) =>
        tx.execute("select * from audit.verify_chain(:company::uuid)", [
          { name: "company", value: f.companyId },
        ]),
      );
      expect(chain.rows[0]).toMatchObject({ ok: true });
    });
    it("AC-2 denies wrong roles and another company without changing the record", async () => {
      const f = await fixture();
      const before = (await f.events()).length;
      for (const role of [
        "tenant",
        "owner",
        "accountant",
        "technician",
      ] as const) {
        const beforeDenial = (await f.events()).length;
        await problem(
          await f.request(
            route(f, "attest-portal"),
            { expectedVersion: 1 },
            role,
          ),
          403,
          "NOT_PERMITTED",
        );
        expect(
          (await f.events())
            .slice(beforeDenial)
            .map((event) => event.event_type),
        ).toEqual(["policy.denied"]);
        expect((await f.events()).at(-1)).toMatchObject({
          subject_type: "tawtheeq_record",
          subject_id: f.recordId,
        });
      }
      const beforeForeign = (await f.events()).length;
      const foreign = await f.request(
        route(f, "attest-portal"),
        { expectedVersion: 1 },
        "managerB",
      );
      const foreignBody = await foreign.clone().text();
      for (const privateValue of [
        f.recordId,
        f.contractId,
        f.ownerId,
        f.tenantId,
      ])
        expect(foreignBody).not.toContain(privateValue);
      await problem(foreign, 404, "NOT_FOUND");
      expect(
        (await f.events())
          .slice(beforeForeign)
          .map((event) => event.event_type),
      ).toEqual(["policy.denied"]);
      expect((await f.view()).version).toBe(1);
      const changes = await f.tx((tx) =>
        rows(
          tx,
          "select count(*) as count from doc.document_version where company_id=:company::uuid",
          z.object({ count: number }),
          { company: f.companyId },
        ),
      );
      expect(changes[0]?.count).toBe(0);
      expect(
        (await f.events()).slice(before).map((event) => event.event_type),
      ).toEqual(Array<string>(5).fill("policy.denied"));
      const owner = await f.view("owner");
      expect(owner.contract.tenant.idNumberMasked).toBe("••••9904");
      expect(owner.contract.owner.idNumberMasked).toBe("••••0001");
      await problem(
        await f.request(`/${f.recordId}`, undefined, "technician"),
        403,
        "NOT_PERMITTED",
      );
      await problem(
        await f.request(`/${f.recordId}`, undefined, "managerB"),
        404,
        "NOT_FOUND",
      );
      expect((await f.events()).at(-1)).toMatchObject({
        event_type: "policy.denied",
        subject_type: "tawtheeq_record",
        subject_id: f.recordId,
      });
    });
    it("AC-3 refuses unknown keys, bad UUIDs, bounds and unsupported uploads", async () => {
      const f = await fixture();
      const versions = () =>
        f.tx((tx) =>
          rows(
            tx,
            "select count(*) as count from audit.entity_version where company_id=:company::uuid",
            z.object({ count: number }),
            { company: f.companyId },
          ),
        );
      const beforeVersions = await versions();
      for (const response of [
        await f.request(route(f, "attest-portal"), {
          expectedVersion: 1,
          extra: true,
        }),
        await f.request("/bad-id/attest-portal", { expectedVersion: 1 }),
        await f.request("?limit=201"),
        await f.request(route(f, "uploads"), {
          fileName: "bad.txt",
          contentType: "text/plain",
          byteSize: 10,
          sha256: "a".repeat(64),
        }),
        await f.request(route(f, "uploads"), {
          fileName: "big.png",
          contentType: "image/png",
          byteSize: 20 * 1024 * 1024 + 1,
          sha256: "a".repeat(64),
        }),
      ])
        expect([400, 422]).toContain(response.status);
      expect((await f.view()).version).toBe(1);
      const documents = await f.tx((tx) =>
        rows(
          tx,
          "select count(*) as count from doc.document_version where company_id=:company::uuid",
          z.object({ count: number }),
          { company: f.companyId },
        ),
      );
      expect(documents[0]?.count).toBe(0);
      expect(await versions()).toEqual(beforeVersions);
    });
    it("AC-4 replays identical commands and rejects a changed body", async () => {
      const f = await fixture();
      const key = randomUUID();
      const path = route(f, "attest-portal");
      const first = await f.request(
        path,
        { expectedVersion: 1 },
        "manager",
        key,
      );
      expect(first.status).toBe(200);
      const firstBody: unknown = await first.json();
      const count = (await f.events()).length;
      const replay = await f.request(
        path,
        { expectedVersion: 1 },
        "manager",
        key,
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await replay.json()).toEqual(firstBody);
      expect((await f.events()).length).toBe(count);
      await problem(
        await f.request(path, { expectedVersion: 2 }, "manager", key),
        422,
        "IDEMPOTENCY_KEY_REUSED",
      );
    });
    it("AC-5 refuses a stale version and audits the rollback", async () => {
      const f = await fixture();
      await f.post("attest-portal", { expectedVersion: 1 });
      const before = (await f.events()).length;
      await problem(
        await f.request(route(f, "portal-return"), {
          expectedVersion: 1,
          reason: "Correction",
        }),
        409,
        "STALE_VERSION",
      );
      expect(
        (await f.events()).slice(before).map((event) => event.event_type),
      ).toEqual(["policy.denied"]);
      expect((await f.view()).version).toBe(2);
    });
    it("AC-6 requires reasons and frozen owner confirmation before skip, then resumes", async () => {
      const f = await fixture();
      await problem(
        await f.request(route(f, "skip"), { expectedVersion: 1 }),
        422,
        "REASON_REQUIRED",
        "REASON_REQUIRED",
      );
      await problem(
        await f.request(route(f, "skip"), {
          expectedVersion: 1,
          reason: "Owner requested deferral",
        }),
        409,
        "INVALID_TRANSITION",
        "OWNER_CONFIRMATION_REQUIRED",
      );
      const requested = await f.post("skip", {
        expectedVersion: 1,
        reason: "Owner requested deferral",
        requestOwnerConfirmation: true,
      });
      expect(requested.workflowState).toBe("awaiting_registration");
      await problem(
        await f.request(route(f, "skip-confirmation"), { decision: "approve" }),
        403,
        "NOT_PERMITTED",
      );
      const confirmed = await f.post(
        "skip-confirmation",
        { decision: "approve" },
        "owner",
      );
      const skipped = await f.post("skip", {
        expectedVersion: confirmed.version,
        reason: "Owner requested deferral",
      });
      expect(skipped).toMatchObject({
        workflowState: "skipped",
        portalStatus: "skipped",
        skipReason: "Owner requested deferral",
      });
      expect(
        (await f.post("resume", { expectedVersion: skipped.version }))
          .workflowState,
      ).toBe("awaiting_registration");
      const ungated = await fixture({ frozenOwnerGate: false });
      const direct = await ungated.post("skip", {
        expectedVersion: 1,
        reason: " Registration deferred ",
      });
      expect(direct.skipReason).toBe("Registration deferred");
      const notifications = await ungated.tx((tx) =>
        rows(
          tx,
          // I inspect committed outbox snapshots because the application cannot read the delivery queue.
          "select snapshot->'payload' as payload from audit.entity_version where company_id=:company::uuid and subject_type='outbox' and snapshot->>'topic'='notification.tawtheeq'",
          z.object({ payload: jsonValue }),
          { company: ungated.companyId },
        ),
      );
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload).toMatchObject({
        recipientRole: "owner",
        template: "tawtheeq_skipped",
        recordId: ungated.recordId,
      });
    });
    it("AC-7 signs checksums, refuses different bytes, and records a clean pinned object", async () => {
      const f = await fixture();
      const response = await f.request(route(f, "uploads"), {
        fileName: "synthetic.png",
        contentType: "image/png",
        byteSize: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      });
      expect(response.status).toBe(201);
      const upload = z
        .object({
          upload: z.object({
            url: z.string(),
            headers: z.record(z.string(), z.string()),
          }),
        })
        .parse(await response.json());
      expect(
        new URL(upload.upload.url).searchParams.get("X-Amz-SignedHeaders"),
      ).toContain("x-amz-checksum-sha256");
      const changed = Buffer.from(png);
      changed[20] = 1;
      expect(
        (
          await fetch(upload.upload.url, {
            method: "PUT",
            headers: upload.upload.headers,
            body: changed,
          })
        ).ok,
      ).toBe(false);
      const clean = await f.upload();
      expect(clean.response.status).toBe(200);
      expect(clean.view).toMatchObject({
        workflowState: "under_review",
        document: { processingStatus: "scan_clean" },
      });
      const stored = await f.tx((tx) =>
        rows(
          tx,
          "select s3_version_id from doc.document_version where company_id=:company::uuid and id=:id::uuid",
          z.object({ s3_version_id: z.string() }),
          { company: f.companyId, id: clean.documentVersionId },
        ),
      );
      expect(stored[0]?.s3_version_id).toBeTruthy();
      const url = await f.request(route(f, "document-url"));
      expect(url.status).toBe(200);
      expect(JSON.stringify(await url.json())).toContain("versionId");
    });
    it("AC-1 keeps a pending certificate unlinked until a clean scan", async () => {
      const f = await fixture();
      const submitted = await f.post("attest-portal", { expectedVersion: 1 });
      let storageCalls = 0;
      f.deps.s3.middlewareStack.add(
        (next) => async (args) => {
          expect(f.activeTransactions.size).toBe(0);
          storageCalls += 1;
          return next(args);
        },
        { step: "initialize", name: "assertClosedTransactions" },
      );
      const before = (await f.events()).length;
      const upload = await f.upload(null);
      await problem(upload.response, 409, "INVALID_TRANSITION", "SCAN_PENDING");
      expect(upload.view).toMatchObject({
        workflowState: "submitted_on_portal",
        version: submitted.version,
        document: null,
      });
      const stored = await f.tx((tx) =>
        rows(
          tx,
          "select processing_status,s3_version_id from doc.document_version where company_id=:company::uuid and id=:id::uuid",
          z.object({
            processing_status: z.string(),
            s3_version_id: z.string(),
          }),
          { company: f.companyId, id: upload.documentVersionId },
        ),
      );
      expect(stored[0]?.processing_status).toBe("uploaded");
      expect(
        (await f.events()).slice(before).map((event) => event.event_type),
      ).toEqual(["document.upload_requested", "document.uploaded"]);
      await problem(
        await f.request(route(f, "extraction"), {}),
        409,
        "INVALID_TRANSITION",
        "SCAN_PENDING",
      );
      await f.deps.s3.send(
        new PutObjectTaggingCommand({
          Bucket: f.deps.buckets.documents ?? "",
          Key: `${f.deps.keyPrefix}companies/${f.companyId}/tawtheeq/${f.recordId}/${upload.documentVersionId}`,
          VersionId: stored[0]?.s3_version_id,
          Tagging: {
            TagSet: [
              { Key: "GuardDutyMalwareScanStatus", Value: "NO_THREATS_FOUND" },
            ],
          },
        }),
      );
      const key = randomUUID();
      const path = route(f, `uploads/${upload.documentVersionId}/complete`);
      const response = await f.request(
        path,
        { expectedVersion: submitted.version },
        "manager",
        key,
      );
      expect(response.status).toBe(200);
      const completed: unknown = await response.json();
      expect(completed).toMatchObject({
        workflowState: "under_review",
        version: submitted.version + 1,
        document: {
          documentVersionId: upload.documentVersionId,
          processingStatus: "scan_clean",
        },
      });
      const eventCount = (await f.events()).length;
      const calls = storageCalls;
      const replay = await f.request(
        path,
        { expectedVersion: submitted.version },
        "manager",
        key,
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await replay.json()).toEqual(completed);
      expect((await f.events()).length).toBe(eventCount);
      expect(storageCalls).toBe(calls);
    });
    it("AC-2 retains rejected scan history and permits replacement uploads", async () => {
      const f = await fixture();
      const before = (await f.events()).length;
      const infected = await f.upload("THREATS_FOUND");
      await problem(
        infected.response,
        422,
        "VALIDATION_FAILED",
        "SCAN_REJECTED",
      );
      expect(infected.view).toMatchObject({
        workflowState: "awaiting_registration",
        version: 1,
        document: null,
      });
      const stored = await f.tx((tx) =>
        rows(
          tx,
          "select v.processing_status,v.scan_result,d.current_version_id from doc.document_version v join doc.document d on d.company_id=v.company_id and d.id=v.document_id where v.company_id=:company::uuid and v.id=:id::uuid",
          z.object({
            processing_status: z.string(),
            scan_result: z.string(),
            current_version_id: z.uuid().nullable(),
          }),
          { company: f.companyId, id: infected.documentVersionId },
        ),
      );
      expect(stored).toEqual([
        {
          processing_status: "scan_rejected",
          scan_result: "THREATS_FOUND",
          current_version_id: null,
        },
      ]);
      const events = (await f.events()).slice(before);
      expect(events.map((event) => event.event_type)).toEqual([
        "document.upload_requested",
        "document.scan_rejected",
      ]);
      expect(events[1]).toMatchObject({
        reason: "Malware scan did not report a clean result",
        details: {
          documentVersionId: infected.documentVersionId,
          processingStatus: "scan_rejected",
          scanResult: "THREATS_FOUND",
        },
      });
      const repeat = await f.request(
        route(f, `uploads/${infected.documentVersionId}/complete`),
        { expectedVersion: 1 },
      );
      await problem(repeat, 422, "VALIDATION_FAILED", "SCAN_REJECTED");
      expect((await f.events()).length).toBe(before + 2);
      expect(
        (
          await f.request(route(f, "uploads"), {
            fileName: "replacement.png",
            contentType: "image/png",
            byteSize: png.length,
            sha256: createHash("sha256").update(png).digest("hex"),
          })
        ).status,
      ).toBe(201);
      const history = await f.tx((tx) =>
        rows(
          tx,
          "select processing_status from doc.document_version where company_id=:company::uuid order by version_no",
          z.object({ processing_status: z.string() }),
          { company: f.companyId },
        ),
      );
      expect(history.map((version) => version.processing_status)).toEqual([
        "scan_rejected",
        "awaiting_upload",
      ]);
    });
  },
);
