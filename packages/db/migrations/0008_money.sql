create table money.instalment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_version_id uuid not null,
  seq_no integer not null check (seq_no > 0),
  due_on date not null,
  amount_fils bigint not null check (amount_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  status text not null check (status in ('open','partly_paid','paid','waived','cancelled')),
  unique (company_id, contract_version_id, seq_no),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_version_id) references lease.contract_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.instalment');
--> statement-breakpoint
create index instalment_contract_version_id_idx on money.instalment(company_id, contract_version_id);
--> statement-breakpoint
create table money.cheque (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
instalment_id uuid not null,
  cheque_no text not null,
  bank_name text not null,
  drawer_name text not null,
  cheque_date date not null,
  amount_fils bigint not null check (amount_fils > 0),
  status text not null check (status in ('pending','received','deposited','cleared','partly_paid','bounced','replaced','returned_to_drawer')),
  replaces_cheque_id uuid,
  deposited_on date,
  check (deposited_on is null or deposited_on >= cheque_date),
  check (replaces_cheque_id is null or replaces_cheque_id <> id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, instalment_id) references money.instalment(company_id, id),
  foreign key (company_id, replaces_cheque_id) references money.cheque(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.cheque');
--> statement-breakpoint
create index cheque_instalment_id_idx on money.cheque(company_id, instalment_id);
--> statement-breakpoint
create index cheque_replaces_cheque_id_idx on money.cheque(company_id, replaces_cheque_id);
--> statement-breakpoint
create table money.charge (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid,
  ticket_id uuid,
  kind text not null check (kind in ('maintenance','utility','penalty','fee','other')),
  payer text not null check (payer in ('owner','tenant','company')),
  amount_fils bigint not null check (amount_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  status text not null check (status in ('open','invoiced','settled','waived','cancelled')),
  check (num_nonnulls(contract_id, ticket_id) >= 1),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.charge');
--> statement-breakpoint
create index charge_contract_id_idx on money.charge(company_id, contract_id);
--> statement-breakpoint
create index charge_ticket_id_idx on money.charge(company_id, ticket_id);
--> statement-breakpoint
create table money.payment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid not null,
  method text not null check (method in ('cash','transfer','cheque','card_elsewhere')),
  amount_fils bigint not null check (amount_fils > 0),
  received_on date not null,
  source text not null check (source in ('app','external')),
  external_ref text,
  cheque_id uuid,
  status text not null check (status in ('recorded','reversed')),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id),
  foreign key (company_id, cheque_id) references money.cheque(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.payment');
--> statement-breakpoint
create index payment_contract_id_idx on money.payment(company_id, contract_id);
--> statement-breakpoint
create index payment_cheque_id_idx on money.payment(company_id, cheque_id);
--> statement-breakpoint
create table money.allocation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
payment_id uuid not null,
  instalment_id uuid,
  charge_id uuid,
  amount_fils bigint not null check (amount_fils > 0),
  status text not null check (status in ('active','voided')),
  check (num_nonnulls(instalment_id, charge_id) = 1),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, payment_id) references money.payment(company_id, id),
  foreign key (company_id, instalment_id) references money.instalment(company_id, id),
  foreign key (company_id, charge_id) references money.charge(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.allocation');
--> statement-breakpoint
create index allocation_payment_id_idx on money.allocation(company_id, payment_id);
--> statement-breakpoint
create index allocation_instalment_id_idx on money.allocation(company_id, instalment_id);
--> statement-breakpoint
create index allocation_charge_id_idx on money.allocation(company_id, charge_id);
--> statement-breakpoint
create table money.payment_reversal (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
payment_id uuid not null,
  reason_code text not null check (reason_code in ('bounced','recorded_in_error')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  unique (company_id, payment_id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, payment_id) references money.payment(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.payment_reversal');
--> statement-breakpoint
create index payment_reversal_payment_id_idx on money.payment_reversal(company_id, payment_id);
--> statement-breakpoint
create table money.refund (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
payment_id uuid not null,
  amount_fils bigint not null check (amount_fils > 0),
  reason text not null check (nullif(btrim(reason), '') is not null),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, payment_id) references money.payment(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.refund');
--> statement-breakpoint
create index refund_payment_id_idx on money.refund(company_id, payment_id);
--> statement-breakpoint
create function money.enforce_conservation() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  prior jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
  current_row jsonb := to_jsonb(NEW);
  payment_row record;
  target record;
  capacity numeric;
  allocated numeric;
  refunded numeric;
begin
  -- I lock affected payments first, then affected targets in identifier order.
  for payment_row in
    select p.id, p.amount_fils, p.status from money.payment p
    where p.company_id = NEW.company_id and
      ((TG_TABLE_NAME = 'payment' and p.id = NEW.id) or
       (TG_TABLE_NAME in ('allocation','refund') and p.id in
         ((current_row->>'payment_id')::uuid, (prior->>'payment_id')::uuid)))
    order by p.id for update
  loop
    if payment_row.status = 'recorded' then
      select coalesce(sum(amount_fils), 0) into allocated from money.allocation
        where company_id = NEW.company_id and payment_id = payment_row.id and status = 'active';
      select coalesce(sum(amount_fils), 0) into refunded from money.refund
        where company_id = NEW.company_id and payment_id = payment_row.id;
      if allocated + refunded > payment_row.amount_fils then
        raise exception using errcode = 'AQ020', message = 'Payment allocations and refunds exceed received amount';
      end if;
    end if;
  end loop;
  for target in
    select i.id, 'instalment'::text as kind from money.instalment i
    where i.company_id = NEW.company_id and
      ((TG_TABLE_NAME = 'instalment' and i.id = NEW.id) or
       (TG_TABLE_NAME = 'allocation' and i.id in ((current_row->>'instalment_id')::uuid, (prior->>'instalment_id')::uuid)) or
       (TG_TABLE_NAME = 'payment' and exists (select 1 from money.allocation a where a.company_id = NEW.company_id and a.payment_id = NEW.id and a.instalment_id = i.id)))
    union all
    select c.id, 'charge'::text from money.charge c
    where c.company_id = NEW.company_id and
      ((TG_TABLE_NAME = 'charge' and c.id = NEW.id) or
       (TG_TABLE_NAME = 'allocation' and c.id in ((current_row->>'charge_id')::uuid, (prior->>'charge_id')::uuid)) or
       (TG_TABLE_NAME = 'payment' and exists (select 1 from money.allocation a where a.company_id = NEW.company_id and a.payment_id = NEW.id and a.charge_id = c.id)))
    order by id, kind
  loop
    if target.kind = 'instalment' then
      select amount_fils::numeric + vat_fils into capacity from money.instalment
        where company_id = NEW.company_id and id = target.id for update;
    else
      select amount_fils::numeric + vat_fils into capacity from money.charge
        where company_id = NEW.company_id and id = target.id for update;
    end if;
    select coalesce(sum(a.amount_fils), 0) into allocated
      from money.allocation a join money.payment p on p.company_id = a.company_id and p.id = a.payment_id
      where a.company_id = NEW.company_id and a.status = 'active' and p.status = 'recorded'
        and ((target.kind = 'instalment' and a.instalment_id = target.id) or (target.kind = 'charge' and a.charge_id = target.id));
    if allocated > capacity then
      raise exception using errcode = 'AQ020', message = 'Allocations exceed the target amount including VAT';
    end if;
  end loop;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger conservation after insert or update on money.allocation for each row execute function money.enforce_conservation();
--> statement-breakpoint
create trigger conservation after insert or update on money.refund for each row execute function money.enforce_conservation();
--> statement-breakpoint
create trigger conservation after insert or update on money.payment for each row execute function money.enforce_conservation();
--> statement-breakpoint
create trigger conservation after insert or update on money.instalment for each row execute function money.enforce_conservation();
--> statement-breakpoint
create trigger conservation after insert or update on money.charge for each row execute function money.enforce_conservation();
--> statement-breakpoint
create table money.deposit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid not null,
  amount_fils bigint not null check (amount_fils >= 0),
  status text not null check (status in ('expected','held','refund_due','refunded','applied','carried_over')),
  deductions jsonb not null default '[]' check (jsonb_typeof(deductions) = 'array'),
  refund_due_on date,
  carried_to_contract_id uuid,
  unique (company_id, contract_id),
  check (carried_to_contract_id is null or carried_to_contract_id <> contract_id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id),
  foreign key (company_id, carried_to_contract_id) references lease.contract(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.deposit');
--> statement-breakpoint
create index deposit_contract_id_idx on money.deposit(company_id, contract_id);
--> statement-breakpoint
create index deposit_carried_to_contract_id_idx on money.deposit(company_id, carried_to_contract_id);
--> statement-breakpoint
create table money.invoice (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
series text not null default 'INV' check (series = 'INV'),
  number bigint check (number > 0),
  is_tax_invoice boolean not null default false,
  issuer_trn text,
  recipient_type text not null check (recipient_type in ('tenant','owner')),
  recipient_id uuid not null,
  recipient_trn text,
  issue_date date not null,
  supply_date date not null,
  total_fils bigint not null check (total_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  status text not null check (status in ('draft','issued','partly_paid','paid','credited')),
  pdf_document_version_id uuid,
  check (vat_fils = 0 or issuer_trn is not null),
  check (status = 'draft' or number is not null),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, pdf_document_version_id) references doc.document_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.invoice');
--> statement-breakpoint
create index invoice_pdf_document_version_id_idx on money.invoice(company_id, pdf_document_version_id);
--> statement-breakpoint
create unique index invoice_number_idx on money.invoice(company_id, series, number) where number is not null;
--> statement-breakpoint
create index invoice_recipient_idx on money.invoice(company_id, recipient_type, recipient_id);
--> statement-breakpoint
create function money.check_invoice_recipient() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if NEW.recipient_type = 'tenant' then
    perform 1 from party.tenant where company_id = NEW.company_id and id = NEW.recipient_id for key share;
  else
    perform 1 from party.owner where company_id = NEW.company_id and id = NEW.recipient_id for key share;
  end if;
  if not found then
    raise exception using errcode = '23503', message = 'Invoice recipient must belong to the company';
  end if;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger b_recipient before insert or update on money.invoice for each row execute function money.check_invoice_recipient();
--> statement-breakpoint
create table money.invoice_line (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
invoice_id uuid not null,
  instalment_id uuid,
  charge_id uuid,
  description_en text not null,
  description_ar text not null,
  amount_fils bigint not null check (amount_fils >= 0),
  vat_bp integer not null check (vat_bp in (0, 500)),
  vat_fils bigint not null check (vat_fils >= 0),
  check (num_nonnulls(instalment_id, charge_id) = 1),
  check (vat_fils = (amount_fils * vat_bp + 5000) / 10000),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, invoice_id) references money.invoice(company_id, id),
  foreign key (company_id, instalment_id) references money.instalment(company_id, id),
  foreign key (company_id, charge_id) references money.charge(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.invoice_line');
--> statement-breakpoint
create index invoice_line_invoice_id_idx on money.invoice_line(company_id, invoice_id);
--> statement-breakpoint
create index invoice_line_instalment_id_idx on money.invoice_line(company_id, instalment_id);
--> statement-breakpoint
create index invoice_line_charge_id_idx on money.invoice_line(company_id, charge_id);
--> statement-breakpoint
create table money.credit_note (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
invoice_id uuid not null,
  number bigint not null check (number > 0),
  amount_fils bigint not null check (amount_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  reason text not null check (nullif(btrim(reason), '') is not null),
  pdf_document_version_id uuid,
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, invoice_id) references money.invoice(company_id, id),
  foreign key (company_id, pdf_document_version_id) references doc.document_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.credit_note');
--> statement-breakpoint
create index credit_note_invoice_id_idx on money.credit_note(company_id, invoice_id);
--> statement-breakpoint
create index credit_note_pdf_document_version_id_idx on money.credit_note(company_id, pdf_document_version_id);
--> statement-breakpoint
create table money.receipt (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
payment_id uuid not null,
  number bigint check (number > 0),
  status text not null check (status in ('issued','voided')),
  void_reason text,
  external_issuer text,
  external_receipt_no text,
  pdf_document_version_id uuid,
  unique (company_id, payment_id),
  check (status <> 'voided' or nullif(btrim(void_reason), '') is not null),
  check ((number is not null and external_issuer is null and external_receipt_no is null)
    or (number is null and nullif(btrim(external_issuer), '') is not null and nullif(btrim(external_receipt_no), '') is not null)),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, payment_id) references money.payment(company_id, id),
  foreign key (company_id, pdf_document_version_id) references doc.document_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.receipt');
--> statement-breakpoint
create index receipt_payment_id_idx on money.receipt(company_id, payment_id);
--> statement-breakpoint
create index receipt_pdf_document_version_id_idx on money.receipt(company_id, pdf_document_version_id);
--> statement-breakpoint
create unique index receipt_number_idx on money.receipt(company_id, number) where number is not null;
--> statement-breakpoint
create unique index receipt_external_idx on money.receipt(company_id, external_issuer, external_receipt_no) where external_issuer is not null and external_receipt_no is not null;
--> statement-breakpoint
create table money.owner_statement (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
owner_id uuid not null,
  period_start date not null,
  period_end date not null,
  opening_fils bigint not null,
  collections_fils bigint not null,
  fees_fils bigint not null,
  expenses_fils bigint not null,
  payouts_fils bigint not null,
  closing_fils bigint not null,
  number bigint check (number > 0),
  status text not null check (status in ('draft','in_review','issued','superseded')),
  check (period_end >= period_start),
  check (closing_fils = opening_fils + collections_fils - fees_fils - expenses_fils - payouts_fils),
  unique (company_id, number),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, owner_id) references party.owner(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.owner_statement');
--> statement-breakpoint
create index owner_statement_owner_id_idx on money.owner_statement(company_id, owner_id);
--> statement-breakpoint
create table money.owner_payout (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
owner_id uuid not null,
  amount_fils bigint not null check (amount_fils > 0),
  paid_on date not null,
  method text not null,
  reference text,
  statement_id uuid,
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, owner_id) references party.owner(company_id, id),
  foreign key (company_id, statement_id) references money.owner_statement(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('money.owner_payout');
--> statement-breakpoint
create index owner_payout_owner_id_idx on money.owner_payout(company_id, owner_id);
--> statement-breakpoint
create index owner_payout_statement_id_idx on money.owner_payout(company_id, statement_id);
