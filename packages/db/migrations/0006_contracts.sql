create table lease.contract (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_no text not null,
  tenant_id uuid not null,
  status text not null check (status in ('draft','awaiting_owner_approval','awaiting_tenant_acceptance','concluded','ended','cancelled')),
  origin text not null check (origin in ('app','retroactive')),
  end_reason text check (end_reason in ('expired','renewed','terminated_by_notice','terminated_by_agreement','terminated_by_court_order','cancelled_on_portal')),
  cancel_reason text,
  cancel_kind text check (cancel_kind in ('withdrawn_by_manager','returned_by_owner','returned_by_tenant','cancelled_draft')),
  renewal_of_id uuid,
  revision_of_id uuid,
  current_version_id uuid,
  search_norm text generated always as (ops.norm(coalesce(contract_no, ''))) stored,
  unique (company_id, contract_no),
  unique (company_id, revision_of_id),
  check ((status = 'ended') = (end_reason is not null)),
  check ((status = 'cancelled' and cancel_kind is not null and nullif(btrim(cancel_reason), '') is not null)
    or (status <> 'cancelled' and cancel_kind is null and cancel_reason is null)),
  check (renewal_of_id is null or renewal_of_id <> id),
  check (revision_of_id is null or revision_of_id <> id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, tenant_id) references party.tenant(company_id, id),
  foreign key (company_id, renewal_of_id) references lease.contract(company_id, id),
  foreign key (company_id, revision_of_id) references lease.contract(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.contract');
--> statement-breakpoint
create index contract_tenant_id_idx on lease.contract(company_id, tenant_id);
--> statement-breakpoint
create index contract_renewal_of_id_idx on lease.contract(company_id, renewal_of_id);
--> statement-breakpoint
create index contract_revision_of_id_idx on lease.contract(company_id, revision_of_id);
--> statement-breakpoint
create index contract_search_idx on lease.contract using gin(search_norm gin_trgm_ops);
--> statement-breakpoint
create function lease.check_revision() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if NEW.revision_of_id is not null then
    perform 1 from lease.contract where company_id = NEW.company_id and id = NEW.revision_of_id and status = 'cancelled' for update;
    if not found then
      raise exception using errcode = '23514', message = 'Revision requires a cancelled contract';
    end if;
  end if;
  if TG_OP = 'UPDATE' and OLD.status = 'cancelled' and NEW.status <> 'cancelled'
     and exists (select 1 from lease.contract where company_id = OLD.company_id and revision_of_id = OLD.id) then
    raise exception using errcode = '23514', message = 'A revised contract must remain cancelled';
  end if;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger b_check_revision before insert or update on lease.contract for each row execute function lease.check_revision();
--> statement-breakpoint
create table lease.contract_version (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid not null,
  version_no integer not null check (version_no > 0),
  kind text not null check (kind in ('standard','tawtheeq_adoption')),
  term_start date not null,
  term_end date not null,
  grace_days integer not null default 0 check (grace_days >= 0),
  annual_rent_fils bigint not null check (annual_rent_fils >= 0),
  total_fils bigint not null check (total_fils >= 0),
  deposit_fils bigint not null check (deposit_fils >= 0),
  vat_bp integer not null check (vat_bp in (0, 500)),
  services jsonb not null default '[]' check (jsonb_typeof(services) = 'array'),
  template_code text,
  template_version integer check (template_version > 0),
  rendered_body_key text,
  rendered_body_sha256 text check (rendered_body_sha256 ~ '^[0-9a-f]{64}$'),
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  frozen_owner_gate boolean,
  submitted_at timestamptz,
  check (term_end > term_start),
  unique (company_id, contract_id, version_no),
  unique (company_id, contract_id, id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.contract_version');
--> statement-breakpoint
create index contract_version_contract_id_idx on lease.contract_version(company_id, contract_id);
--> statement-breakpoint
alter table lease.contract add constraint contract_current_version_fk foreign key (company_id, id, current_version_id) references lease.contract_version(company_id, contract_id, id);
--> statement-breakpoint
create index contract_current_version_idx on lease.contract(company_id, id, current_version_id);
--> statement-breakpoint
create function lease.reject_submitted_version_update() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if OLD.submitted_at is not null then
    raise exception using errcode = 'AQ010', message = 'Submitted contract version is immutable';
  end if;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger b_submitted_immutable before update on lease.contract_version for each row execute function lease.reject_submitted_version_update();
--> statement-breakpoint
create table lease.contract_version_clause (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_version_id uuid not null,
  position integer not null check (position > 0),
  clause_key text not null,
  source text not null check (source in ('library','company','special')),
  text_en text not null,
  text_ar text not null,
  model_translated boolean not null default false,
  unique (company_id, contract_version_id, position),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_version_id) references lease.contract_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.contract_version_clause');
--> statement-breakpoint
create index contract_version_clause_contract_version_id_idx on lease.contract_version_clause(company_id, contract_version_id);
--> statement-breakpoint
create function lease.check_version_child_mutation() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare parent record;
begin
  for parent in
    select id, submitted_at from lease.contract_version
    where company_id = NEW.company_id and
      (id = NEW.contract_version_id or (TG_OP = 'UPDATE' and id = OLD.contract_version_id))
    order by id for update
  loop
    if parent.submitted_at is not null then
      raise exception using errcode = 'AQ010', message = 'Submitted version children are immutable';
    end if;
  end loop;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger b_submitted_immutable before insert or update on lease.contract_version_clause for each row execute function lease.check_version_child_mutation();
--> statement-breakpoint
create table lease.contract_unit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid not null,
  unit_id uuid not null,
  occupancy_start date not null,
  occupancy_end date not null,
  blocks_unit boolean not null default false,
  check (occupancy_end >= occupancy_start),
  unique (company_id, contract_id, unit_id),
  exclude using gist (company_id with =, unit_id with =, daterange(occupancy_start, occupancy_end, '[]') with &&) where (blocks_unit),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id),
  foreign key (company_id, unit_id) references estate.unit(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.contract_unit');
--> statement-breakpoint
create index contract_unit_contract_id_idx on lease.contract_unit(company_id, contract_id);
--> statement-breakpoint
create index contract_unit_unit_id_idx on lease.contract_unit(company_id, unit_id);
--> statement-breakpoint
create table lease.occupant (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_version_id uuid not null,
  full_name text not null,
  relationship text not null check (relationship in ('spouse','child','parent','relative','domestic_worker','other')),
  eid_number text check (eid_number ~ '^[0-9]{15}$'),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_version_id) references lease.contract_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.occupant');
--> statement-breakpoint
create index occupant_contract_version_id_idx on lease.occupant(company_id, contract_version_id);
--> statement-breakpoint
create trigger b_submitted_immutable before insert or update on lease.occupant for each row execute function lease.check_version_child_mutation();
--> statement-breakpoint
create table lease.contract_template (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  code text not null,
  template_version integer not null check (template_version > 0),
  name_en text not null,
  name_ar text not null,
  body_en text not null,
  body_ar text not null,
  unique nulls not distinct (company_id, code, template_version),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
alter table lease.contract_template enable row level security;
--> statement-breakpoint
alter table lease.contract_template force row level security;
--> statement-breakpoint
create policy reference_read on lease.contract_template for select to aqarak_app, aqarak_pipeline, aqarak_scheduler using (company_id is null or company_id = ops.ctx_company_id());
--> statement-breakpoint
create policy reference_insert on lease.contract_template for insert to aqarak_app with check (company_id = ops.ctx_company_id());
--> statement-breakpoint
create policy reference_update on lease.contract_template for update to aqarak_app using (company_id = ops.ctx_company_id()) with check (company_id = ops.ctx_company_id());
--> statement-breakpoint
create trigger a_stamp_update before update on lease.contract_template for each row execute function ops.stamp_update();
--> statement-breakpoint
create trigger z_row_size before insert or update on lease.contract_template for each row execute function ops.check_row_size();
--> statement-breakpoint
create trigger capture_version after insert or update on lease.contract_template for each row when (NEW.company_id is not null) execute function audit.capture_entity_version();
--> statement-breakpoint
create trigger reject_delete before delete or truncate on lease.contract_template for each statement execute function ops.reject_mutation();
--> statement-breakpoint
revoke all on lease.contract_template from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant select, insert, update on lease.contract_template to aqarak_app;
--> statement-breakpoint
grant select on lease.contract_template to aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create table lease.clause (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  clause_key text not null,
  text_en text not null,
  text_ar text not null,
  unique nulls not distinct (company_id, clause_key),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
alter table lease.clause enable row level security;
--> statement-breakpoint
alter table lease.clause force row level security;
--> statement-breakpoint
create policy reference_read on lease.clause for select to aqarak_app, aqarak_pipeline, aqarak_scheduler using (company_id is null or company_id = ops.ctx_company_id());
--> statement-breakpoint
create policy reference_insert on lease.clause for insert to aqarak_app with check (company_id = ops.ctx_company_id());
--> statement-breakpoint
create policy reference_update on lease.clause for update to aqarak_app using (company_id = ops.ctx_company_id()) with check (company_id = ops.ctx_company_id());
--> statement-breakpoint
create trigger a_stamp_update before update on lease.clause for each row execute function ops.stamp_update();
--> statement-breakpoint
create trigger z_row_size before insert or update on lease.clause for each row execute function ops.check_row_size();
--> statement-breakpoint
create trigger capture_version after insert or update on lease.clause for each row when (NEW.company_id is not null) execute function audit.capture_entity_version();
--> statement-breakpoint
create trigger reject_delete before delete or truncate on lease.clause for each statement execute function ops.reject_mutation();
--> statement-breakpoint
revoke all on lease.clause from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant select, insert, update on lease.clause to aqarak_app;
--> statement-breakpoint
grant select on lease.clause to aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create table lease.tawtheeq_record (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid not null,
  path text not null check (path in ('normal','skip','retroactive')),
  workflow_state text not null check (workflow_state in ('awaiting_registration','submitted_on_portal','under_review','discrepancies_open','awaiting_owner_reapproval','registered','skipped','closed')),
  portal_status text not null check (portal_status in ('not_started','pending','registered','renewed','skipped','cancelled')),
  tawtheeq_number text,
  registered_on date,
  tawtheeq_document_version_id uuid,
  skip_reason text,
  unique (company_id, contract_id),
  check (workflow_state <> 'registered' or (tawtheeq_document_version_id is not null and nullif(btrim(tawtheeq_number), '') is not null)),
  check ((workflow_state <> 'skipped' and portal_status <> 'skipped') or nullif(btrim(skip_reason), '') is not null),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id),
  foreign key (company_id, tawtheeq_document_version_id) references doc.document_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.tawtheeq_record');
--> statement-breakpoint
create index tawtheeq_record_contract_id_idx on lease.tawtheeq_record(company_id, contract_id);
--> statement-breakpoint
create index tawtheeq_record_tawtheeq_document_version_id_idx on lease.tawtheeq_record(company_id, tawtheeq_document_version_id);
--> statement-breakpoint
create table lease.discrepancy (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
tawtheeq_record_id uuid not null,
  document_version_id uuid not null,
  field_key text not null,
  app_value jsonb,
  tawtheeq_value jsonb,
  class text not null check (class in ('identity','material','minor')),
  resolution text check (resolution in ('adopt','cancel_and_reregister','mark_equivalent')),
  reason text,
  status text not null check (status in ('open','resolved')),
  check (resolution <> 'mark_equivalent' or class = 'minor'),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, tawtheeq_record_id) references lease.tawtheeq_record(company_id, id),
  foreign key (company_id, document_version_id) references doc.document_version(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.discrepancy');
--> statement-breakpoint
create index discrepancy_tawtheeq_record_id_idx on lease.discrepancy(company_id, tawtheeq_record_id);
--> statement-breakpoint
create index discrepancy_document_version_id_idx on lease.discrepancy(company_id, document_version_id);
--> statement-breakpoint
create table lease.approval (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_version_id uuid,
  quote_id uuid,
  tawtheeq_record_id uuid,
  discrepancy_id uuid,
  subject_id uuid generated always as (coalesce(contract_version_id, quote_id, tawtheeq_record_id, discrepancy_id)) stored,
  slot text not null check (slot in ('manager','owner','tenant')),
  kind text not null check (kind in ('contract_approval','owner_reapproval','skip_confirmation','cost_approval','retroactive_confirmation')),
  approver_account_id uuid not null references core.person_account(id),
  on_behalf_of_party_id uuid,
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('requested','approved','returned','voided')),
  reason text,
  check (num_nonnulls(contract_version_id, quote_id, tawtheeq_record_id, discrepancy_id) = 1),
  check (status not in ('returned','voided') or nullif(btrim(reason), '') is not null),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_version_id) references lease.contract_version(company_id, id),
  foreign key (company_id, tawtheeq_record_id) references lease.tawtheeq_record(company_id, id),
  foreign key (company_id, discrepancy_id) references lease.discrepancy(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.approval');
--> statement-breakpoint
create index approval_contract_version_id_idx on lease.approval(company_id, contract_version_id);
--> statement-breakpoint
create index approval_tawtheeq_record_id_idx on lease.approval(company_id, tawtheeq_record_id);
--> statement-breakpoint
create index approval_discrepancy_id_idx on lease.approval(company_id, discrepancy_id);
--> statement-breakpoint
create index approval_quote_id_idx on lease.approval(company_id, quote_id);
--> statement-breakpoint
create index approval_approver_account_idx on lease.approval(approver_account_id);
--> statement-breakpoint
create unique index approval_active_slot_idx on lease.approval(company_id, subject_id, slot) where status in ('requested','approved');
--> statement-breakpoint
create unique index approval_approved_person_idx on lease.approval(company_id, subject_id, approver_account_id) where status = 'approved';
--> statement-breakpoint
create table lease.handover (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
contract_id uuid not null,
  unit_id uuid not null,
  kind text not null check (kind in ('move_in','move_out')),
  occurred_on date not null,
  meter_readings jsonb not null default '{}' check (jsonb_typeof(meter_readings) = 'object'),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id),
  foreign key (company_id, unit_id) references estate.unit(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.handover');
--> statement-breakpoint
create index handover_contract_id_idx on lease.handover(company_id, contract_id);
--> statement-breakpoint
create index handover_unit_id_idx on lease.handover(company_id, unit_id);
