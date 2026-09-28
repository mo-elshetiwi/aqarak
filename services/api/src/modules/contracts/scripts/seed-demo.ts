import { randomUUID } from "node:crypto";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { z } from "zod";
import { withCompanyTx } from "../runtime/db";
import { parameters } from "../runtime/sql";
import { insertAudit } from "../runtime/audit";
export const demoIdsSchema = z.strictObject({
  companyId: z.uuid(),
  manager: z.uuid(),
  owner: z.uuid(),
  tenant: z.uuid(),
  tenantId: z.uuid(),
  ownerId: z.uuid(),
  unitId: z.uuid(),
  propertyId: z.uuid(),
  mandateId: z.uuid(),
});
export type DemoIds = z.infer<typeof demoIdsSchema>;
export async function seedDemo(executor: DataApiExecutor): Promise<DemoIds> {
  const ids: DemoIds = {
    companyId: randomUUID(),
    manager: randomUUID(),
    owner: randomUUID(),
    tenant: randomUUID(),
    tenantId: randomUUID(),
    ownerId: randomUUID(),
    unitId: randomUUID(),
    propertyId: randomUUID(),
    mandateId: randomUUID(),
  };
  await withCompanyTx(
    executor,
    { companyId: ids.companyId, accountId: ids.manager },
    async (tx) => {
      await tx.execute(
        "insert into core.company(id,kind,legal_name_en,legal_name_ar,is_demo) values (:id::uuid,:kind,'Demo company (synthetic)','شركة تجريبية (synthetic)',true)",
        parameters({
          id: ids.companyId,
          kind: "management_company",
        }),
      );
      for (const [role, id] of Object.entries({
        manager: ids.manager,
        owner: ids.owner,
        tenant: ids.tenant,
      })) {
        await tx.execute(
          "select set_config('app.account_id',:id,true)",
          parameters({ id }),
        );
        await tx.execute(
          "insert into core.person_account(id,auth_subject,email,display_name,preferred_language) values (:id::uuid,:id,:email,:name,:language)",
          parameters({
            id,
            email: `success+${role}-${id.slice(0, 8)}@simulator.amazonses.com`,
            name: `${role} (synthetic)`,
            language: role === "owner" ? "ar" : "en",
          }),
        );
        await tx.execute(
          "insert into core.account_company_link(company_id,account_id,kind,status) values (:company::uuid,:id::uuid,:kind,'active')",
          parameters({
            company: ids.companyId,
            id,
            kind:
              role === "owner"
                ? "owner"
                : role === "tenant"
                  ? "tenant"
                  : "staff",
          }),
        );
      }
      await tx.execute(
        "select set_config('app.account_id',:id,true)",
        parameters({ id: ids.manager }),
      );
      await tx.execute(
        "insert into core.membership(company_id,account_id,status,is_manager) values (:company::uuid,:id::uuid,'active',true)",
        parameters({ company: ids.companyId, id: ids.manager }),
      );
      await tx.execute(
        "insert into party.owner(id,company_id,full_name_en,full_name_ar,linked_account_id) values (:id::uuid,:company::uuid,'Owner (synthetic)','مالك (synthetic)',:account::uuid)",
        parameters({
          id: ids.ownerId,
          company: ids.companyId,
          account: ids.owner,
        }),
      );
      await tx.execute(
        "insert into party.tenant(id,company_id,kind,full_name_en,full_name_ar,linked_account_id) values (:id::uuid,:company::uuid,'individual','Tenant (synthetic)','مستأجر (synthetic)',:account::uuid)",
        parameters({
          id: ids.tenantId,
          company: ids.companyId,
          account: ids.tenant,
        }),
      );
      await tx.execute(
        "insert into estate.property(id,company_id,name_en,name_ar,kind,owner_gate_override) values (:id::uuid,:company::uuid,'Residence (synthetic)','سكن (synthetic)','building',:gate)",
        parameters({
          id: ids.propertyId,
          company: ids.companyId,
          gate: null,
        }),
      );
      await tx.execute(
        "insert into estate.unit(id,company_id,property_id,unit_no,use,kind,status) values (:id::uuid,:company::uuid,:property::uuid,'Synthetic 101','residential','apartment','vacant')",
        parameters({
          id: ids.unitId,
          company: ids.companyId,
          property: ids.propertyId,
        }),
      );
      await tx.execute(
        "insert into estate.ownership(company_id,owner_id,property_id,share_bp,is_representative) values (:company::uuid,:owner::uuid,:property::uuid,10000,true)",
        parameters({
          company: ids.companyId,
          owner: ids.ownerId,
          property: ids.propertyId,
        }),
      );
      {
        const document = randomUUID();
        const version = randomUUID();
        await tx.execute(
          "insert into doc.document(id,company_id,subject_type,subject_id,doc_type,sensitivity) values (:id::uuid,:company::uuid,'tenant',:tenant::uuid,'emirates_id','identity')",
          parameters({
            id: document,
            company: ids.companyId,
            tenant: ids.tenantId,
          }),
        );
        await tx.execute(
          "insert into doc.document_version(id,company_id,document_id,version_no,bucket,s3_key,sha256,byte_size,content_type,processing_status,review_status) values (:id::uuid,:company::uuid,:document::uuid,1,'synthetic-test-bucket',:key,repeat('a',64),100,'application/pdf','scan_clean','accepted')",
          parameters({
            id: version,
            company: ids.companyId,
            document,
            key: `test/contracts/${version}/synthetic-emirates-id.pdf`,
          }),
        );
        await tx.execute(
          "update doc.document set current_version_id=:version::uuid where id=:id::uuid",
          parameters({ version, id: document }),
        );
      }
      await tx.execute(
        "insert into estate.owner_mandate(id,company_id,owner_id,owner_gate,starts_on,status) values (:id::uuid,:company::uuid,:owner::uuid,null,current_date,'active')",
        parameters({
          id: ids.mandateId,
          company: ids.companyId,
          owner: ids.ownerId,
        }),
      );
      await tx.execute(
        "insert into estate.mandate_property(company_id,mandate_id,property_id) values (:company::uuid,:mandate::uuid,:property::uuid)",
        parameters({
          company: ids.companyId,
          mandate: ids.mandateId,
          property: ids.propertyId,
        }),
      );
      const event = await insertAudit(
        tx,
        {
          companyId: ids.companyId,
          accountId: ids.manager,
          role: "manager",
          channel: "web_form",
          key: null,
          traceId: null,
        },
        {
          eventType: "company.created",
          subjectType: "company",
          subjectId: ids.companyId,
          after: 1,
          fields: ["kind", "legal_name_en"],
        },
      );
      await tx.execute(
        `insert into audit.event_subject(company_id,event_id,subject_type,subject_id,subject_version)
      select v.company_id,:event::uuid,v.subject_type,v.subject_id,v.subject_version from audit.entity_version v
      where v.tx_id=pg_current_xact_id()::text::bigint and not exists(select 1 from audit.event_subject s where s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version)`,
        parameters({ event }),
      );
    },
  );
  return ids;
}
