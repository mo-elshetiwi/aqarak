import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { withSystemTx } from "@aqarak/db";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { writeAuditEvent, coverTransactionVersions } from "../../audit/kernel";
import { contractContentHash } from "../comparison";
import { execute } from "../storage";
export type SeedRole =
  | "manager"
  | "secondManager"
  | "owner"
  | "tenant"
  | "accountant"
  | "technician"
  | "managerB";
export interface SeedOptions {
  withoutContract?: boolean;
  companyId?: string;
  frozenOwnerGate?: boolean;
  annualRentFils?: number;
  depositFils?: number;
}
export interface Seed {
  companyId: string;
  companyBId: string;
  recordId: string;
  contractId: string;
  contractVersionId: string;
  ownerId: string;
  tenantId: string;
  unitId: string;
  propertyId: string;
  accounts: Record<SeedRole, string>;
  sessions: Record<SeedRole, string>;
  contentHash: string;
}
/** I seed only synthetic companies, parties and contracts, with complete version coverage. */
export async function seed(
  executor: DataApiExecutor,
  options: SeedOptions = {},
): Promise<Seed> {
  const accounts: Seed["accounts"] = {
    manager: randomUUID(),
    secondManager: randomUUID(),
    owner: randomUUID(),
    tenant: randomUUID(),
    accountant: randomUUID(),
    technician: randomUUID(),
    managerB: randomUUID(),
  };
  const sessions = Object.fromEntries(
    Object.keys(accounts).map((role) => [
      role,
      randomBytes(32).toString("base64url"),
    ]),
  ) as Seed["sessions"];
  const companyId = z.uuid().parse(options.companyId ?? randomUUID());
  const companyBId = randomUUID();
  const data = {
    companyId,
    companyBId,
    recordId: randomUUID(),
    contractId: randomUUID(),
    contractVersionId: randomUUID(),
    ownerId: randomUUID(),
    tenantId: randomUUID(),
    unitId: randomUUID(),
    propertyId: randomUUID(),
    accounts,
    sessions,
    contentHash: "",
  };
  const terms = {
    term_start: "2026-08-13",
    term_end: "2027-08-12",
    annual_rent_fils: options.annualRentFils ?? 22000000,
    total_fils: options.annualRentFils ?? 22000000,
    deposit_fils: options.depositFils ?? 2030000,
    grace_days: 0,
    vat_bp: 500,
    services: [],
    template_code: null,
    template_version: null,
    contract_type: "RESIDENTIAL",
    owner_name: "Omar Al Nuaimi",
    tenant_name: "Mohammed Farouk",
    unt_number: "711",
    owner_id_number: "784000000000001",
    tenant_id_number: "784196400029904",
  };
  data.contentHash = contractContentHash(terms);
  for (const company of [companyId, companyBId])
    await withSystemTx(executor, { companyId: company }, async (tx) => {
      await execute(
        tx,
        "insert into core.company(id,kind,legal_name_en,legal_name_ar,is_demo) values (:company::uuid,'management_company',:name,:arabic,true)",
        {
          company,
          name:
            company === companyId
              ? "Synthetic Smoke Properties"
              : "Synthetic Smoke Properties B",
          arabic: "عقارات تجريبية اصطناعية",
        },
      );
      for (const [key, account] of Object.entries(accounts)) {
        const role = key as SeedRole;
        if ((role === "managerB") !== (company === companyBId)) continue;
        await execute(tx, "select set_config('app.account_id',:account,true)", {
          account,
        });
        await execute(
          tx,
          "insert into core.person_account(id,auth_subject,email,display_name,preferred_language) values (:account::uuid,:subject,:email,:name,'en')",
          {
            account,
            subject: `synthetic-${account}`,
            email: `synthetic-${account}@example.invalid`,
            name: `Synthetic ${role}`,
          },
        );
        const kind = role === "owner" || role === "tenant" ? role : "staff";
        await execute(
          tx,
          "insert into core.account_company_link(company_id,account_id,kind,status) values (:company::uuid,:account::uuid,:kind,'active')",
          { company, account, kind },
        );
        if (kind === "staff")
          await execute(
            tx,
            "insert into core.membership(company_id,account_id,status,is_manager,is_accountant,is_technician) values (:company::uuid,:account::uuid,'active',:manager,:accountant,:technician)",
            {
              company,
              account,
              manager: ["manager", "secondManager", "managerB"].includes(role),
              accountant: role === "accountant",
              technician: role === "technician",
            },
          );
      }
      const manager =
        company === companyId ? accounts.manager : accounts.managerB;
      await execute(tx, "select set_config('app.account_id',:account,true)", {
        account: manager,
      });
      if (company === companyId) {
        await execute(
          tx,
          "insert into party.owner(id,company_id,full_name_en,full_name_ar,eid_number,linked_account_id) values (:id::uuid,:company::uuid,'Omar Al Nuaimi','عمر النعيمي','784000000000001',:account::uuid)",
          { id: data.ownerId, company, account: accounts.owner },
        );
        await execute(
          tx,
          "insert into party.tenant(id,company_id,kind,full_name_en,full_name_ar,eid_number,linked_account_id) values (:id::uuid,:company::uuid,'individual','Mohammed Farouk','محمد فاروق','784196400029904',:account::uuid)",
          { id: data.tenantId, company, account: accounts.tenant },
        );
        await execute(
          tx,
          "insert into estate.property(id,company_id,name_en,name_ar,kind) values (:id::uuid,:company::uuid,'Synthetic Building','مبنى تجريبي','building')",
          { id: data.propertyId, company },
        );
        await execute(
          tx,
          "insert into estate.unit(id,company_id,property_id,unit_no,unt_number,use,kind,status) values (:id::uuid,:company::uuid,:property::uuid,'711','711','residential','apartment','occupied')",
          { id: data.unitId, company, property: data.propertyId },
        );
        await execute(
          tx,
          "insert into estate.ownership(company_id,owner_id,property_id,share_bp,is_representative) values (:company::uuid,:owner::uuid,:property::uuid,10000,true)",
          { company, owner: data.ownerId, property: data.propertyId },
        );
        if (!options.withoutContract) {
          await execute(
            tx,
            "insert into lease.contract(id,company_id,contract_no,tenant_id,status,origin) values (:id::uuid,:company::uuid,:number,:tenant::uuid,'concluded','app')",
            {
              id: data.contractId,
              company,
              number: `SYN-${data.contractId}`,
              tenant: data.tenantId,
            },
          );
          await execute(
            tx,
            "insert into lease.contract_version(id,company_id,contract_id,version_no,kind,term_start,term_end,annual_rent_fils,total_fils,deposit_fils,vat_bp,content_hash,frozen_owner_gate,submitted_at) values (:id::uuid,:company::uuid,:contract::uuid,1,'standard','2026-08-13','2027-08-12',:rent::bigint,:rent::bigint,:deposit::bigint,500,:hash,:gate,now())",
            {
              id: data.contractVersionId,
              company,
              contract: data.contractId,
              rent: terms.annual_rent_fils,
              deposit: terms.deposit_fils,
              hash: data.contentHash,
              gate: options.frozenOwnerGate ?? true,
            },
          );
          await execute(
            tx,
            "update lease.contract set current_version_id=:version::uuid where company_id=:company::uuid and id=:contract::uuid",
            {
              company,
              version: data.contractVersionId,
              contract: data.contractId,
            },
          );
          await execute(
            tx,
            "insert into lease.contract_unit(company_id,contract_id,unit_id,occupancy_start,occupancy_end,blocks_unit) values (:company::uuid,:contract::uuid,:unit::uuid,'2026-08-13','2027-08-12',true)",
            { company, contract: data.contractId, unit: data.unitId },
          );
          await execute(
            tx,
            "insert into lease.tawtheeq_record(id,company_id,contract_id,path,workflow_state,portal_status) values (:id::uuid,:company::uuid,:contract::uuid,'normal','awaiting_registration','not_started')",
            { id: data.recordId, company, contract: data.contractId },
          );
        }
      }
      const event = await writeAuditEvent(tx, company, {
        eventType: "company.seeded",
        actorAccountId: manager,
        actorRole: "manager",
        initiator: "person",
        channel: "web_form",
        subjectType: "company",
        subjectId: company,
        versionBefore: null,
        versionAfter: 1,
      });
      await coverTransactionVersions(tx, company, event.eventId);
    });
  return data;
}
