import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { localExecutor, localOptions } from "./cli.ts";
import {
  runCheck,
  runNumbers,
  sqlState,
  type Check,
  type Evidence,
} from "../src/spike/dom-checks.ts";

const ref = (name: string): string => `current_setting('test.${name}')::uuid`;
const company = "ops.ctx_company_id()";
const checks: Check[] = [
  {
    name: "overlapping blocking unit dates",
    expected: "23P01",
    setup: `insert into lease.contract_unit(company_id, contract_id, unit_id, occupancy_start, occupancy_end, blocks_unit) values (${company}, ${ref("contract")}, ${ref("unit")}, '2027-01-01', '2027-06-30', true)`,
    sql: `with second_contract as (
  insert into lease.contract(company_id, contract_no, tenant_id, status, origin)
  select company_id, 'SYNTHETIC-2', tenant_id, 'draft', 'app' from lease.contract where id = ${ref("contract")}
  returning id
) insert into lease.contract_unit(company_id, contract_id, unit_id, occupancy_start, occupancy_end, blocks_unit)
  select ${company}, id, ${ref("unit")}, '2027-06-30', '2027-12-31', true from second_contract`,
  },
  {
    name: "cheque deposit before its date",
    expected: "23514",
    sql: `insert into money.cheque(company_id, instalment_id, cheque_no, bank_name, drawer_name, cheque_date, deposited_on, amount_fils, status) values (${company}, ${ref("instalment")}, 'SYNTHETIC-1', 'Synthetic bank', 'Synthetic drawer', '2027-02-01', '2027-01-31', 1000, 'received')`,
  },
  {
    name: "owner statement reconciliation",
    expected: "23514",
    sql: `insert into money.owner_statement(company_id, owner_id, period_start, period_end, opening_fils, collections_fils, fees_fils, expenses_fils, payouts_fils, closing_fils, status) values (${company}, ${ref("owner")}, '2027-01-01', '2027-01-31', 100, 200, 10, 20, 30, 999, 'draft')`,
  },
  {
    name: "invoice VAT rounded half up",
    expected: "23514",
    sql: `insert into money.invoice_line(company_id, invoice_id, instalment_id, description_en, description_ar, amount_fils, vat_bp, vat_fils) values (${company}, ${ref("invoice")}, ${ref("instalment")}, 'Synthetic item', 'بند تجريبي', 10, 500, 0)`,
  },
  {
    name: "submitted contract version update",
    expected: "AQ010",
    setup: `update lease.contract_version set submitted_at = now() where id = ${ref("contract_version")}`,
    sql: `update lease.contract_version set grace_days = 1 where id = ${ref("contract_version")}`,
  },
  {
    name: "submitted clause insertion",
    expected: "AQ010",
    setup: `update lease.contract_version set submitted_at = now() where id = ${ref("contract_version")}`,
    sql: `insert into lease.contract_version_clause(company_id, contract_version_id, position, clause_key, source, text_en, text_ar) values (${company}, ${ref("contract_version")}, 1, 'synthetic', 'special', 'Synthetic clause', 'بند تجريبي')`,
  },
  {
    name: "C1 payment over-allocation",
    expected: "AQ020",
    setup: `update money.payment set amount_fils = 100 where id = ${ref("payment")}`,
    sql: `insert into money.allocation(company_id, payment_id, instalment_id, amount_fils, status) values (${company}, ${ref("payment")}, ${ref("instalment")}, 101, 'active')`,
  },
  {
    name: "C2 target over-allocation",
    expected: "AQ020",
    setup: `update money.instalment set amount_fils = 100 where id = ${ref("instalment")}`,
    sql: `insert into money.allocation(company_id, payment_id, instalment_id, amount_fils, status) values (${company}, ${ref("payment")}, ${ref("instalment")}, 101, 'active')`,
  },
  {
    name: "refund participates in C1",
    expected: "AQ020",
    setup: `insert into money.allocation(company_id, payment_id, instalment_id, amount_fils, status) values (${company}, ${ref("payment")}, ${ref("instalment")}, 10000, 'active')`,
    sql: `insert into money.refund(company_id, payment_id, amount_fils, reason) values (${company}, ${ref("payment")}, 1, 'Synthetic refund')`,
  },
  {
    name: "payment reduction preserves C1",
    expected: "AQ020",
    setup: `insert into money.allocation(company_id, payment_id, instalment_id, amount_fils, status) values (${company}, ${ref("payment")}, ${ref("instalment")}, 10000, 'active')`,
    sql: `update money.payment set amount_fils = 9999 where id = ${ref("payment")}`,
  },
  {
    name: "instalment reduction preserves C2",
    expected: "AQ020",
    setup: `insert into money.allocation(company_id, payment_id, instalment_id, amount_fils, status) values (${company}, ${ref("payment")}, ${ref("instalment")}, 10000, 'active')`,
    sql: `update money.instalment set amount_fils = 9999 where id = ${ref("instalment")}`,
  },
  {
    name: "revision requires cancelled predecessor",
    expected: "23514",
    sql: `insert into lease.contract(company_id, contract_no, tenant_id, status, origin, revision_of_id) select company_id, 'SYNTHETIC-REV', tenant_id, 'draft', 'app', id from lease.contract where id = ${ref("contract")}`,
  },
  {
    name: "runtime grants remain narrow",
    expected: "success",
    sql: `do $$ begin
      if has_table_privilege('aqarak_app', 'ops.number_series', 'SELECT')
        or has_table_privilege('aqarak_scheduler', 'ops.number_series', 'UPDATE')
        or has_table_privilege('aqarak_app', 'ops.idempotency_key', 'DELETE')
        or not has_table_privilege('aqarak_scheduler', 'ops.idempotency_key', 'DELETE')
        or has_column_privilege('aqarak_app', 'ops.idempotency_key', 'request_sha256', 'UPDATE')
        or not has_column_privilege('aqarak_app', 'ops.idempotency_key', 'response', 'UPDATE')
        or has_table_privilege('aqarak_app', 'ai.model_call', 'INSERT')
        or has_table_privilege('aqarak_scheduler', 'ai.extraction', 'INSERT')
        or not has_table_privilege('aqarak_pipeline', 'ai.extraction', 'INSERT')
        or not has_table_privilege('aqarak_scheduler', 'work.reminder', 'UPDATE')
      then raise exception 'Runtime grant mismatch'; end if;
    end $$`,
  },
  {
    name: "normalization and large number formatting",
    expected: "success",
    sql: `do $$ begin
      if ops.norm(U&'\\0623\\064E\\0640\\0649\\0629 \\0661\\06F2\\200F') <> U&'\\0627\\064A\\0647 12' or ops.norm('ＦＯＯ') <> 'foo' then
        raise exception 'Normalization mismatch';
      end if;
      if ops.format_number('INV', 123) <> 'INV-000123' or ops.format_number('INV', 1234567) <> 'INV-1234567' then
        raise exception 'Number formatting mismatch';
      end if;
    end $$`,
  },
  {
    name: "cross-company foreign key rejection",
    expected: "23503",
    sql: `with other_company as (insert into core.company(kind, is_demo) values ('management_company', true) returning id) insert into estate.unit(company_id, property_id, unit_no, use, kind, status) select other_company.id, u.property_id, 'SYNTHETIC-CROSS', 'residential', 'apartment', 'vacant' from estate.unit u cross join other_company where u.id = ${ref("unit")}`,
  },
  {
    name: "material discrepancy cannot be equivalent",
    expected: "23514",
    sql: `insert into lease.discrepancy(company_id, tawtheeq_record_id, document_version_id, field_key, class, resolution, status) values (${company}, gen_random_uuid(), gen_random_uuid(), 'annual_rent_fils', 'material', 'mark_equivalent', 'resolved')`,
  },
  {
    name: "extraction field bounds and provenance",
    expected: "success",
    sql: `do $$ begin
      if not ai.valid_extraction_fields('{"rent":{"value":10000,"confidence":0.95,"page":1,"evidence":"Synthetic evidence"}}'::jsonb)
        or ai.valid_extraction_fields('{"rent":{"value":10000,"confidence":1.1,"page":1,"evidence":"Synthetic evidence"}}'::jsonb)
        or ai.valid_extraction_fields('{"rent":{"value":10000,"confidence":0.95,"page":0,"evidence":"Synthetic evidence"}}'::jsonb)
        or ai.valid_extraction_fields(jsonb_build_object('rent', jsonb_build_object('value', repeat('x', 2001), 'confidence', 1, 'page', 1, 'evidence', 'Synthetic evidence')))
      then raise exception 'Extraction field validation mismatch'; end if;
    end $$`,
  },
  {
    name: "valid half-fils VAT rounds up",
    expected: "success",
    sql: `insert into money.invoice_line(company_id, invoice_id, instalment_id, description_en, description_ar, amount_fils, vat_bp, vat_fils) values (${company}, ${ref("invoice")}, ${ref("instalment")}, 'Synthetic item', 'بند تجريبي', 10, 500, 1)`,
  },
];

async function main(): Promise<void> {
  const options = localOptions();
  const executor = localExecutor(options, options.masterSecretArn);
  const fixture = await readFile(
    new URL("./dom-fixture.sql", import.meta.url),
    "utf8",
  );
  const results: Evidence[] = [];
  for (const check of checks)
    results.push(await runCheck(executor, fixture, check));
  results.push(await runNumbers(executor, fixture));
  const report = {
    observedAt: new Date().toISOString(),
    database: options.database,
    checks: results,
    passed: results.every((result) => result.passed && result.rolledBack),
  };
  const output =
    options.out ||
    `spikes/results/domain-invariants-${new Date().toISOString().slice(0, 10)}.json`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
await main().catch((error: unknown) => {
  const state = sqlState(error);
  process.stderr.write(`Domain checks stopped (SQLSTATE: ${state})\n`);
  process.exitCode = 1;
});
