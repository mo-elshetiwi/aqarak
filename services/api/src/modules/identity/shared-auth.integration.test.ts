import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiModules } from "../index";
import { createDocumentsModule } from "../documents";
import {
  createHarness,
  uploadFixture,
  type UploadFixture,
} from "../tenants/integration-support";
import {
  harness,
  events,
  assertChain,
  type Harness,
  type TestAccount,
} from "./integration-support";
import { authenticateRequest } from "./adapters";
import { auditEvent, one, rows } from "./database";
import { setIdentityProvider } from "./runtime";
import { deliverPendingInvitations } from "./invitation-relay";
import { dependencyFactory } from "../contracts/runtime/dependencies";

const object = z.record(z.string(), z.unknown());
const entity = (body: unknown, name: string) =>
  object.parse(object.parse(body)[name]);
describe.skipIf(process.env.DATABASE_NAME !== "aqarak_integration")(
  "shared identity across company modules",
  () => {
    let h: Harness;
    let manager: TestAccount;
    let other: TestAccount;
    let company: string;
    let foreignCompany: string;
    let application: Hono;
    let ownerId: string;
    let tenantId: string;
    let propertyId: string;
    let mediaId: string;
    let document: UploadFixture;
    async function request(
      method: string,
      suffix: string,
      body?: unknown,
      options: { anonymous?: boolean; companyId?: string } = {},
    ) {
      return application.request(
        `/v1/companies/${options.companyId ?? company}${suffix}`,
        {
          method,
          headers: {
            ...(!options.anonymous
              ? { Authorization: `Session ${manager.session}` }
              : {}),
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
    }
    async function create(
      suffix: string,
      body: unknown,
      name: string,
    ): Promise<Record<string, unknown>> {
      const response = await request("POST", suffix, body);
      const result: unknown = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(201);
      return entity(result, name);
    }
    beforeAll(async () => {
      h = harness();
      setIdentityProvider(h.deps.identityProvider);
      manager = await h.account();
      other = await h.account();
      company = await h.company(manager);
      foreignCompany = await h.company(other);
      await h.inCompany(company, manager, async (tx) => {
        const before = await one(
          tx,
          "select * from core.membership where account_id=cast(:account as uuid)",
          { account: manager.id },
        );
        const after = await one(
          tx,
          "update core.membership set is_manager=true where id=cast(:id as uuid) returning *",
          { id: String(before.id) },
        );
        await auditEvent(tx, {
          companyId: company,
          principal: manager.principal,
          eventType: "membership.roles_changed",
          primary: {
            type: "membership",
            id: String(before.id),
            before: Number(before.version),
            after: Number(after.version),
          },
        });
      });
      const documents = createHarness();
      application = new Hono();
      for (const module of apiModules) {
        const selected =
          module.name === "documents"
            ? createDocumentsModule({
                ...documents.deps,
                authenticate: authenticateRequest,
              })
            : module;
        const routes = new Hono();
        selected.register(routes);
        application.route(selected.basePath, routes);
      }
      ownerId = z.uuid().parse(
        (
          await create(
            "/owners",
            {
              fullName: { en: "Synthetic Owner", ar: "مالك تجريبي" },
              email: `owner-${randomUUID()}@example.com`,
              preferredLanguage: "en",
            },
            "owner",
          )
        ).id,
      );
      propertyId = z.uuid().parse(
        (
          await create(
            "/properties",
            {
              name: { en: "Synthetic Property", ar: "عقار تجريبي" },
              kind: "building",
              use: "residential",
              ownerId,
              ownerGateOverride: true,
            },
            "property",
          )
        ).id,
      );
      const unitsResponse = await request(
        "POST",
        `/properties/${propertyId}/units`,
        {
          units: [
            { unitNo: "101", use: "residential", kind: "apartment" },
            { unitNo: "102", use: "residential", kind: "apartment" },
          ],
        },
      );
      expect(unitsResponse.status).toBe(201);
      const unitId = await h.inCompany(company, manager, async (tx) =>
        String(
          (await one(tx, "select id from estate.unit order by id limit 1")).id,
        ),
      );
      tenantId = z.uuid().parse(
        (
          await create(
            "/tenants",
            {
              kind: "individual",
              fullNameEn: "Synthetic Tenant",
              fullNameAr: "مستأجر تجريبي",
              email: `tenant-${randomUUID()}@example.com`,
              preferredLanguage: "en",
            },
            "tenant",
          )
        ).id,
      );
      document = await uploadFixture(
        { ...documents, companyA: company, managerA: manager.id },
        tenantId,
      );
      mediaId = randomUUID();
      await h.inCompany(company, manager, async (tx) => {
        const source = await one(
          tx,
          "select * from doc.document_version where id=cast(:id as uuid)",
          { id: document.versionId },
        );
        await rows(
          tx,
          "insert into maint.media(id,company_id,created_by,unit_id,kind,uploaded_by_account_id,bucket,s3_key,s3_version_id,sha256,byte_size,content_type,processing_status,upload_expires_at) values(cast(:id as uuid),cast(:company as uuid),cast(:account as uuid),cast(:unit as uuid),'photo',cast(:account as uuid),:bucket,:key,:version,:sha,:size,:type,'uploaded',now()+interval '5 minutes')",
          {
            id: mediaId,
            company,
            account: manager.id,
            unit: unitId,
            bucket: String(source.bucket),
            key: String(source.s3_key),
            version: String(source.s3_version_id),
            sha: String(source.sha256),
            size: Number(source.byte_size),
            type: String(source.content_type),
          },
        );
        await auditEvent(tx, {
          companyId: company,
          principal: manager.principal,
          eventType: "media.uploaded",
          primary: { type: "media", id: mediaId, after: 1 },
        });
      });
    }, 300_000);
    const routes = [
      ["owners", () => `/owners/${ownerId}`, "GET"],
      ["properties", () => `/properties/${propertyId}`, "GET"],
      ["tenants", () => `/tenants/${tenantId}`, "GET"],
      [
        "documents",
        () =>
          `/documents/${document.documentId}/versions/${document.versionId}`,
        "GET",
      ],
      [
        "extraction",
        () =>
          `/documents/${document.documentId}/versions/${document.versionId}/extraction`,
        "POST",
      ],
      ["contracts", () => "/contracts", "GET"],
      ["approvals", () => "/approvals", "GET"],
      ["notifications", () => "/notifications", "GET"],
      ["tawtheeq", () => "/tawtheeq", "GET"],
      ["audit", () => "/audit/events", "GET"],
      ["media", () => `/media/${mediaId}/download`, "GET"],
      ["maintenance", () => "/maintenance/units", "GET"],
    ] as const;
    for (const [module, suffix, method] of routes)
      it(`${module}: session manager 200, foreign company 404 with one denial, anonymous 401`, async () => {
        const body = method === "POST" ? {} : undefined;
        expect(
          (await request(method, suffix(), body, { anonymous: true })).status,
        ).toBe(401);
        const before = (await events(h, foreignCompany, other)).filter(
          (row) => row.event_type === "policy.denied",
        ).length;
        const foreign = await request(method, suffix(), body, {
          companyId: foreignCompany,
        });
        expect(foreign.status, await foreign.text()).toBe(404);
        const after = (await events(h, foreignCompany, other)).filter(
          (row) => row.event_type === "policy.denied",
        ).length;
        expect(after - before).toBe(1);
        const response = await request(method, suffix(), body);
        expect(response.status, await response.text()).toBe(200);
      });
    it.each(["owner", "tenant"] as const)(
      "%s invitation outbox delivers a hashed token and links the invitee",
      async (kind) => {
        const invitee = await h.account();
        const target =
          kind === "owner"
            ? await create(
                "/owners",
                {
                  fullName: { en: "Invited Owner", ar: "مالك مدعو" },
                  email: invitee.email,
                  preferredLanguage: "ar",
                },
                "owner",
              )
            : await create(
                "/tenants",
                {
                  kind: "individual",
                  fullNameEn: "Invited Tenant",
                  fullNameAr: "مستأجر مدعو",
                  email: invitee.email,
                  preferredLanguage: "ar",
                },
                "tenant",
              );
        const path =
          kind === "owner"
            ? `/owners/${String(target.id)}/invitation`
            : `/tenants/${String(target.id)}/invitations`;
        const response = await request("POST", path, {});
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(201);
        expect(JSON.stringify(body)).not.toContain("token");
        await h.inCompany(company, manager, async (tx) => {
          const before = await one(
            tx,
            "select * from core.invitation where target_id=cast(:id as uuid) and status='pending'",
            { id: String(target.id) },
          );
          expect(String(before.token_hash)).toMatch(/^[0-9a-f]{64}$/);
          const after = await one(
            tx,
            "update core.invitation set expires_at=now()-interval '1 minute' where id=cast(:id as uuid) returning *",
            { id: String(before.id) },
          );
          await auditEvent(tx, {
            companyId: company,
            principal: manager.principal,
            eventType: "invitation.expiry_adjusted",
            primary: {
              type: "invitation",
              id: String(before.id),
              before: Number(before.version),
              after: Number(after.version),
            },
          });
        });
        const replacement = await request("POST", path, {});
        expect(replacement.status, await replacement.text()).toBe(201);
        const statuses = await h.inCompany(company, manager, (tx) =>
          rows(
            tx,
            "select status from core.invitation where target_id=cast(:id as uuid) order by created_at",
            { id: String(target.id) },
          ),
        );
        expect(statuses.map((row) => row.status)).toEqual([
          "expired",
          "pending",
        ]);
        const counts = await deliverPendingInvitations({
          deps: h.deps,
          schedulerExecutor: dependencyFactory()().schedulerExecutor,
          companyId: company,
        });
        expect(counts.failed).toBe(0);
        const message = h.emails.find((email) => email.to === invitee.email);
        expect(message).toBeDefined();
        const token = /\/ar\/invitation#([A-Za-z0-9_-]{43})/.exec(
          message?.text ?? "",
        )?.[1];
        expect(token).toBeDefined();
        const accepted = await h.request("POST", "/v1/invitations/accept", {
          account: invitee,
          body: { token },
          key: randomUUID(),
        });
        expect(accepted.status, await accepted.text()).toBe(200);
        const stored = await h.inCompany(company, manager, (tx) =>
          one(
            tx,
            `select linked_account_id from party.${kind} where id=cast(:id as uuid)`,
            { id: String(target.id) },
          ),
        );
        expect(stored.linked_account_id).toBe(invitee.id);
        await assertChain(h, company, manager);
      },
    );
  },
);
