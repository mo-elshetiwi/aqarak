do $$
declare
  company uuid := ops.ctx_company_id();
  tenant uuid := gen_random_uuid();
  owner uuid := gen_random_uuid();
  property uuid := gen_random_uuid();
  unit uuid := gen_random_uuid();
  contract uuid := gen_random_uuid();
  contract_version uuid := gen_random_uuid();
  instalment uuid := gen_random_uuid();
  payment uuid := gen_random_uuid();
  invoice uuid := gen_random_uuid();
begin
  insert into core.company(id, kind, legal_name_en, legal_name_ar, is_demo)
    values (company, 'management_company', 'Synthetic schema check', 'فحص مخطط تجريبي', true);
  insert into party.tenant(id, company_id, kind) values (tenant, company, 'individual');
  insert into party.owner(id, company_id) values (owner, company);
  insert into estate.property(id, company_id, kind) values (property, company, 'building');
  insert into estate.unit(id, company_id, property_id, unit_no, use, kind, status)
    values (unit, company, property, 'SYNTHETIC-1', 'residential', 'apartment', 'vacant');
  insert into lease.contract(id, company_id, contract_no, tenant_id, status, origin)
    values (contract, company, 'SYNTHETIC-1', tenant, 'draft', 'app');
  insert into lease.contract_version(id, company_id, contract_id, version_no, kind, term_start, term_end, annual_rent_fils, total_fils, deposit_fils, vat_bp)
    values (contract_version, company, contract, 1, 'standard', '2027-01-01', '2027-12-31', 10000, 10000, 1000, 0);
  insert into money.instalment(id, company_id, contract_version_id, seq_no, due_on, amount_fils, vat_fils, status)
    values (instalment, company, contract_version, 1, '2027-01-01', 10000, 0, 'open');
  insert into money.payment(id, company_id, contract_id, method, amount_fils, received_on, source, status)
    values (payment, company, contract, 'cash', 10000, '2027-01-01', 'app', 'recorded');
  insert into money.invoice(id, company_id, recipient_type, recipient_id, issue_date, supply_date, total_fils, vat_fils, status)
    values (invoice, company, 'tenant', tenant, '2027-01-01', '2027-01-01', 10000, 0, 'draft');
  perform set_config('test.owner', owner::text, true);
  perform set_config('test.unit', unit::text, true);
  perform set_config('test.contract', contract::text, true);
  perform set_config('test.contract_version', contract_version::text, true);
  perform set_config('test.instalment', instalment::text, true);
  perform set_config('test.payment', payment::text, true);
  perform set_config('test.invoice', invoice::text, true);
end
$$;
