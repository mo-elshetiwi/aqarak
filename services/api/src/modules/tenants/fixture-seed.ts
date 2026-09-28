import type { CompanyTransaction, Row } from "../documents/database";
import { appendAuditEvent } from "../documents/audit";
import { one, str, num } from "../documents/sql";

export async function cover(
  tx: CompanyTransaction,
  context: { company: string; account: string },
  type: string,
  row: Row,
): Promise<void> {
  await appendAuditEvent(tx, {
    companyId: context.company,
    accountId: context.account,
    type: `${type}.created`,
    subjectType: type,
    subjectId: str(row, "id"),
    versionAfter: num(row, "version"),
  });
}
export async function createAccount(
  tx: CompanyTransaction,
  company: string,
  account: string,
  email = `j3-${account}@example.com`,
): Promise<void> {
  const row = await one(
    tx,
    `insert into core.person_account(id,auth_subject,email,display_name,preferred_language) values(cast(:id as uuid),:subject,:email,'Synthetic J3 fixture','en') returning id,version`,
    {
      id: account,
      subject: `j3-${account}`,
      email,
    },
  );
  await cover(tx, { company, account }, "person_account", row);
}
export async function seedDemoManager(
  tx: CompanyTransaction,
  input: {
    readonly company: string;
    readonly account: string;
    readonly companyName: string;
    readonly email: string;
  },
): Promise<void> {
  const { company, account, companyName, email } = input;
  const row = await one(
    tx,
    `insert into core.company(id,kind,legal_name_en,is_demo) values(cast(:id as uuid),'management_company',:name,true) returning id,version`,
    { id: company, name: companyName },
  );
  await cover(tx, { company, account }, "company", row);
  await createAccount(tx, company, account, email);
  const membership = await one(
    tx,
    `insert into core.membership(company_id,account_id,is_manager,status) values(cast(:company as uuid),cast(:account as uuid),true,'active') returning id,version`,
    { company, account },
  );
  await cover(tx, { company, account }, "membership", membership);
}
