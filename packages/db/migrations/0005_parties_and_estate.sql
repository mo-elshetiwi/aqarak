create function ops.norm(value text) returns text language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select translate(
    regexp_replace(lower(normalize(value, NFKC)),
      U&'[\064B-\065F\0670\0640\061C\200E\200F\202A-\202E\2066-\2069]', '', 'g'),
    U&'\0622\0623\0625\0671\0649\0629\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
    U&'\0627\0627\0627\0627\064A\0647' || '01234567890123456789')
$$;
--> statement-breakpoint
grant execute on function ops.norm(text) to aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create table party.owner (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
full_name_en text,
  full_name_ar text,
  eid_number text check (eid_number ~ '^[0-9]{15}$'),
  passport_no text,
  email text check (email = lower(email)),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  preferred_language text check (preferred_language in ('en','ar')),
  bank_name text,
  account_holder text,
  iban text,
  linked_account_id uuid references core.person_account(id),
  statement_locked_through date,
  search_norm text generated always as (ops.norm(coalesce(full_name_en, '') || ' ' || coalesce(full_name_ar, '') || ' ' || coalesce(eid_number, '') || ' ' || coalesce(passport_no, ''))) stored,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('party.owner');
--> statement-breakpoint
create index owner_search_idx on party.owner using gin(search_norm gin_trgm_ops);
--> statement-breakpoint
create index owner_linked_account_idx on party.owner(linked_account_id);
--> statement-breakpoint
create table party.tenant (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
kind text not null check (kind in ('individual','company','government','diplomatic')),
  full_name_en text,
  full_name_ar text,
  eid_number text check (eid_number ~ '^[0-9]{15}$'),
  passport_no text,
  trade_licence_no text,
  signatory_name_en text,
  signatory_name_ar text,
  signatory_eid text check (signatory_eid ~ '^[0-9]15$'),
  email text check (email = lower(email)),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  preferred_language text check (preferred_language in ('en','ar')),
  linked_account_id uuid references core.person_account(id),
  search_norm text generated always as (ops.norm(coalesce(full_name_en, '') || ' ' || coalesce(full_name_ar, '') || ' ' || coalesce(eid_number, '') || ' ' || coalesce(passport_no, '') || ' ' || coalesce(trade_licence_no, '') || ' ' || coalesce(signatory_name_en, '') || ' ' || coalesce(signatory_name_ar, '') || ' ' || coalesce(signatory_eid, ''))) stored,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('party.tenant');
--> statement-breakpoint
create index tenant_search_idx on party.tenant using gin(search_norm gin_trgm_ops);
--> statement-breakpoint
create index tenant_linked_account_idx on party.tenant(linked_account_id);
--> statement-breakpoint
create table party.vendor (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
name_en text,
  name_ar text,
  trade_licence_no text,
  email text check (email = lower(email)),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  preferred_language text check (preferred_language in ('en','ar')),
  categories jsonb not null default '[]' check (jsonb_typeof(categories) = 'array'),
  status text not null check (status in ('active','inactive')),
  search_norm text generated always as (ops.norm(coalesce(name_en, '') || ' ' || coalesce(name_ar, '') || ' ' || coalesce(trade_licence_no, ''))) stored,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('party.vendor');
--> statement-breakpoint
create index vendor_search_idx on party.vendor using gin(search_norm gin_trgm_ops);
--> statement-breakpoint
alter table core.technician_profile add constraint technician_profile_vendor_fk foreign key (company_id, vendor_id) references party.vendor(company_id, id);
--> statement-breakpoint
create table estate.property (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
name_en text,
  name_ar text,
  kind text not null check (kind in ('building','villa','plot')),
  area_en text,
  area_ar text,
  plot_no text,
  title_deed_no text,
  onwani_address text,
  owner_gate_override boolean,
  search_norm text generated always as (ops.norm(coalesce(name_en, '') || ' ' || coalesce(name_ar, '') || ' ' || coalesce(area_en, '') || ' ' || coalesce(area_ar, '') || ' ' || coalesce(plot_no, '') || ' ' || coalesce(title_deed_no, '') || ' ' || coalesce(onwani_address, ''))) stored,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('estate.property');
--> statement-breakpoint
create index property_search_idx on estate.property using gin(search_norm gin_trgm_ops);
--> statement-breakpoint
create table estate.unit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
property_id uuid not null,
  unit_no text not null,
  unt_number text,
  use text not null check (use in ('residential','commercial')),
  kind text not null check (kind in ('apartment','villa','townhouse','office','shop','warehouse','other')),
  bedrooms integer check (bedrooms >= 0),
  area_sqm numeric(10,2) check (area_sqm > 0),
  status text not null check (status in ('vacant','listed','reserved','occupied','notice_given','under_maintenance','blocked')),
  block_reason text,
  search_norm text generated always as (ops.norm(coalesce(unit_no, '') || ' ' || coalesce(unt_number, ''))) stored,
  check (status <> 'blocked' or nullif(btrim(block_reason), '') is not null),
  unique (company_id, property_id, unit_no),
  unique (company_id, unt_number),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, property_id) references estate.property(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('estate.unit');
--> statement-breakpoint
create index unit_property_id_idx on estate.unit(company_id, property_id);
--> statement-breakpoint
create index unit_search_idx on estate.unit using gin(search_norm gin_trgm_ops);
--> statement-breakpoint
create table estate.ownership (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
owner_id uuid not null,
  property_id uuid not null,
  share_bp integer not null check (share_bp > 0 and share_bp <= 10000),
  is_representative boolean not null default false,
  unique (company_id, owner_id, property_id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, owner_id) references party.owner(company_id, id),
  foreign key (company_id, property_id) references estate.property(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('estate.ownership');
--> statement-breakpoint
create index ownership_owner_id_idx on estate.ownership(company_id, owner_id);
--> statement-breakpoint
create index ownership_property_id_idx on estate.ownership(company_id, property_id);
--> statement-breakpoint
create table estate.owner_mandate (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
owner_id uuid not null,
  lease_authority text,
  owner_gate boolean,
  cost_threshold_fils bigint check (cost_threshold_fils >= 0),
  emergency_limit_fils bigint check (emergency_limit_fils >= 0),
  fee_bp integer check (fee_bp between 0 and 10000),
  starts_on date not null,
  ends_on date,
  status text not null check (status in ('active','expired','ended')),
  check (ends_on is null or ends_on >= starts_on),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, owner_id) references party.owner(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('estate.owner_mandate');
--> statement-breakpoint
create index owner_mandate_owner_id_idx on estate.owner_mandate(company_id, owner_id);
--> statement-breakpoint
create table estate.mandate_property (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
mandate_id uuid not null,
  property_id uuid not null,
  unique (company_id, mandate_id, property_id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, mandate_id) references estate.owner_mandate(company_id, id),
  foreign key (company_id, property_id) references estate.property(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('estate.mandate_property');
--> statement-breakpoint
create index mandate_property_mandate_id_idx on estate.mandate_property(company_id, mandate_id);
--> statement-breakpoint
create index mandate_property_property_id_idx on estate.mandate_property(company_id, property_id);
--> statement-breakpoint
alter table doc.document add constraint document_doc_type_check check (doc_type in ('emirates_id','passport','title_deed','site_plan','management_agreement','tawtheeq_authorisation','trade_licence','signatory_id','civil_defence_certificate','hassantuk_certificate','floor_plan','maintenance_contract','fire_safety_contract','income_evidence','occupancy_certificate','tawtheeq','contract','receipt','invoice','quote','transfer_slip','cheque_image','portal_summary','photo','voice_note','video','other'));
