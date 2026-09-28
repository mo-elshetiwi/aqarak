create table core.company (
  id uuid primary key default gen_random_uuid(),
  company_id uuid generated always as (id) stored,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  kind text not null check (kind in ('management_company','self_managed_owner')),
  legal_name_en text,
  legal_name_ar text,
  trade_licence_no text,
  trn text,
  default_owner_gate boolean not null default true check (default_owner_gate),
  is_demo boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended')),
  unique (company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('core.company');
--> statement-breakpoint
create policy scheduler_company_read on core.company for select to aqarak_scheduler using (true);
--> statement-breakpoint
alter table audit.audit_event add constraint audit_event_company_fk foreign key (company_id) references core.company(id);
--> statement-breakpoint
create table core.person_account (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  auth_subject text not null unique,
  email text not null unique check (email = lower(email)),
  display_name text,
  preferred_language text not null check (preferred_language in ('en','ar'))
);
--> statement-breakpoint
create table core.account_company_link (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  account_id uuid not null references core.person_account(id),
  kind text not null check (kind in ('staff','owner','tenant')),
  status text not null check (status in ('active','revoked')),
  unique (account_id, company_id, kind),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('core.account_company_link');
--> statement-breakpoint
drop policy company_isolation on core.account_company_link;
--> statement-breakpoint
create policy account_link_scope on core.account_company_link using (account_id = ops.ctx_account_id() or company_id = ops.ctx_company_id()) with check (account_id = ops.ctx_account_id() or company_id = ops.ctx_company_id());
--> statement-breakpoint
create index account_company_link_company_idx on core.account_company_link(company_id, account_id);
--> statement-breakpoint
create function ops.register_account_table(t regclass) returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format('create trigger a_stamp_update before update on %s for each row execute function ops.stamp_update()', t);
  execute format('create trigger z_row_size before insert or update on %s for each row execute function ops.check_row_size()', t);
  execute format('create trigger capture_version after insert or update on %s for each row execute function audit.capture_entity_version()', t);
  execute format('create trigger reject_delete before delete or truncate on %s for each statement execute function ops.reject_mutation()', t);
  execute format('revoke all on %s from public, aqarak_app, aqarak_pipeline, aqarak_scheduler', t);
  execute format('grant select, insert, update on %s to aqarak_app', t);
end
$$;
--> statement-breakpoint
select ops.register_account_table('core.person_account');
--> statement-breakpoint
create policy person_account_scope on core.person_account
using (id = ops.ctx_account_id() or exists (select 1 from core.account_company_link l where l.account_id = person_account.id and l.company_id = ops.ctx_company_id() and l.status = 'active'))
with check (id = ops.ctx_account_id() or exists (select 1 from core.account_company_link l where l.account_id = person_account.id and l.company_id = ops.ctx_company_id() and l.status = 'active'));
--> statement-breakpoint
create table core.device_token (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  account_id uuid not null references core.person_account(id),
  platform text not null check (platform in ('ios','android','web')),
  push_token text not null unique,
  disabled_at timestamptz
);
--> statement-breakpoint
select ops.register_account_table('core.device_token');
--> statement-breakpoint
create policy device_token_scope on core.device_token using (account_id = ops.ctx_account_id()) with check (account_id = ops.ctx_account_id());
--> statement-breakpoint
create index device_token_account_idx on core.device_token(account_id);
--> statement-breakpoint
create table core.membership (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  account_id uuid not null references core.person_account(id),
  is_manager boolean not null default false,
  is_technician boolean not null default false,
  is_company_admin boolean not null default false,
  is_accountant boolean not null default false,
  status text not null check (status in ('invited','active','suspended','removed')),
  check (is_manager or is_technician or is_company_admin or is_accountant),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('core.membership');
--> statement-breakpoint
create unique index membership_active_account_idx on core.membership(account_id) where status = 'active';
--> statement-breakpoint
create index membership_account_idx on core.membership(account_id);
--> statement-breakpoint
create table core.invitation (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  kind text not null check (kind in ('staff','owner','tenant')),
  email text,
  target_id uuid,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  status text not null check (status in ('pending','accepted','expired','revoked')),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('core.invitation');
--> statement-breakpoint
create policy invitation_token_read on core.invitation for select to aqarak_app using (token_hash = current_setting('app.invitation_token_hash', true));
--> statement-breakpoint
create table core.technician_profile (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  membership_id uuid not null,
  vendor_id uuid,
  skills jsonb not null default '[]' check (jsonb_typeof(skills) = 'array'),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  unique (company_id, membership_id),
  foreign key (company_id, membership_id) references core.membership(company_id, id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('core.technician_profile');
--> statement-breakpoint
create index technician_profile_vendor_idx on core.technician_profile(company_id, vendor_id);
--> statement-breakpoint
create table doc.document (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  subject_type text not null,
  subject_id uuid not null,
  doc_type text not null,
  title text,
  sensitivity text not null check (sensitivity in ('identity','financial','general')),
  current_version_id uuid,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('doc.document');
--> statement-breakpoint
create index document_subject_idx on doc.document(company_id, subject_type, subject_id);
--> statement-breakpoint
create table doc.document_version (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  document_id uuid not null,
  version_no integer not null,
  bucket text not null,
  s3_key text not null,
  s3_version_id text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  content_type text not null,
  processing_status text not null default 'awaiting_upload' check (processing_status in ('awaiting_upload','uploaded','scan_clean','scan_rejected','extracting','extracted','extraction_failed')),
  review_status text not null default 'pending_review' check (review_status in ('pending_review','accepted','rejected','superseded')),
  scan_result text,
  scan_event_id text,
  issue_date date,
  expiry_date date,
  reject_reason text,
  uploaded_via text check (uploaded_via in ('web','mobile','email','import')),
  unique (company_id, document_id, version_no),
  unique (bucket, s3_key, s3_version_id),
  foreign key (company_id, document_id) references doc.document(company_id, id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('doc.document_version');
--> statement-breakpoint
alter table doc.document add constraint document_current_version_fk foreign key (company_id, current_version_id) references doc.document_version(company_id, id);
--> statement-breakpoint
create index document_current_version_idx on doc.document(company_id, current_version_id);
--> statement-breakpoint
grant update (processing_status, scan_result, scan_event_id, s3_version_id, byte_size, sha256) on doc.document_version to aqarak_pipeline;
