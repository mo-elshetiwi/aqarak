create table work.note (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
subject_type text not null,
  subject_id uuid not null,
  body text not null check (char_length(body) <= 8000),
  visibility text not null check (visibility in ('staff','parties')),
  search_vector tsvector generated always as (to_tsvector('arabic'::regconfig, coalesce(body, '')) || to_tsvector('english'::regconfig, coalesce(body, ''))) stored,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('work.note');
--> statement-breakpoint
create index note_subject_idx on work.note(company_id, subject_type, subject_id);
--> statement-breakpoint
create index note_search_idx on work.note using gin(search_vector);
--> statement-breakpoint
create table work.task (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
subject_type text not null,
  subject_id uuid not null,
  title text not null,
  assignee_account_id uuid references core.person_account(id),
  due_at timestamptz,
  status text not null check (status in ('open','done','cancelled')),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('work.task');
--> statement-breakpoint
create index task_subject_idx on work.task(company_id, subject_type, subject_id);
--> statement-breakpoint
create index task_assignee_account_idx on work.task(assignee_account_id);
--> statement-breakpoint
create table work.reminder (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
subject_type text not null,
  subject_id uuid not null,
  rule_code text not null check (rule_code ~ '^N([1-9]|1[0-3])$'),
  recipient_account_id uuid not null references core.person_account(id),
  fire_on date not null,
  status text not null check (status in ('scheduled','fired','dismissed')),
  unique (company_id, rule_code, subject_id, fire_on),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('work.reminder');
--> statement-breakpoint
create index reminder_subject_idx on work.reminder(company_id, subject_type, subject_id);
--> statement-breakpoint
create index reminder_recipient_account_idx on work.reminder(recipient_account_id);
--> statement-breakpoint
grant insert, update on work.reminder to aqarak_scheduler;
--> statement-breakpoint
create table work.notification (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
recipient_account_id uuid not null references core.person_account(id),
  channel text not null check (channel in ('in_app','email','push')),
  template_code text not null,
  language text not null check (language in ('en','ar')),
  subject_type text not null,
  subject_id uuid not null,
  status text not null check (status in ('queued','sent','failed')),
  read_at timestamptz,
  dedupe_key text not null unique,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('work.notification');
--> statement-breakpoint
create index notification_subject_idx on work.notification(company_id, subject_type, subject_id);
--> statement-breakpoint
create index notification_recipient_account_idx on work.notification(recipient_account_id);
--> statement-breakpoint
grant insert, update on work.notification to aqarak_scheduler;
--> statement-breakpoint
create table maint.ticket (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
unit_id uuid not null,
  reported_by_account_id uuid not null references core.person_account(id),
  category text not null check (category in ('ac','plumbing','electrical','appliances','pest_control','cleaning','carpentry','painting','lift','fire_safety','other')),
  priority text not null check (priority in ('emergency','urgent','routine')),
  safety_critical boolean not null default false,
  status text not null check (status in ('reported','triaged','awaiting_quote','awaiting_cost_approval','scheduled','in_progress','on_hold','work_completed','closed','cancelled')),
  payer text not null check (payer in ('owner','tenant','company','split')),
  description_en text,
  description_ar text,
  rating integer check (rating between 1 and 5),
  linked_ticket_id uuid,
  search_vector tsvector generated always as (to_tsvector('arabic'::regconfig, coalesce(description_en, '') || ' ' || coalesce(description_ar, '')) || to_tsvector('english'::regconfig, coalesce(description_en, '') || ' ' || coalesce(description_ar, ''))) stored,
  check (linked_ticket_id is null or linked_ticket_id <> id),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, unit_id) references estate.unit(company_id, id),
  foreign key (company_id, linked_ticket_id) references maint.ticket(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('maint.ticket');
--> statement-breakpoint
create index ticket_unit_id_idx on maint.ticket(company_id, unit_id);
--> statement-breakpoint
create index ticket_linked_ticket_id_idx on maint.ticket(company_id, linked_ticket_id);
--> statement-breakpoint
create index ticket_reported_by_account_idx on maint.ticket(reported_by_account_id);
--> statement-breakpoint
create index ticket_search_idx on maint.ticket using gin(search_vector);
--> statement-breakpoint
alter table money.charge add constraint charge_ticket_fk foreign key (company_id, ticket_id) references maint.ticket(company_id, id);
--> statement-breakpoint
create table maint.quote (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
ticket_id uuid not null,
  vendor_id uuid,
  technician_profile_id uuid,
  amount_fils bigint not null check (amount_fils >= 0),
  vat_fils bigint not null check (vat_fils >= 0),
  status text not null check (status in ('requested','received','approved','rejected')),
  check (num_nonnulls(vendor_id, technician_profile_id) = 1),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, ticket_id) references maint.ticket(company_id, id),
  foreign key (company_id, vendor_id) references party.vendor(company_id, id),
  foreign key (company_id, technician_profile_id) references core.technician_profile(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('maint.quote');
--> statement-breakpoint
create index quote_ticket_id_idx on maint.quote(company_id, ticket_id);
--> statement-breakpoint
create index quote_vendor_id_idx on maint.quote(company_id, vendor_id);
--> statement-breakpoint
create index quote_technician_profile_id_idx on maint.quote(company_id, technician_profile_id);
--> statement-breakpoint
alter table lease.approval add constraint approval_quote_fk foreign key (company_id, quote_id) references maint.quote(company_id, id);
--> statement-breakpoint
create table maint.dispatch (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
ticket_id uuid not null,
  technician_profile_id uuid,
  vendor_id uuid,
  visit_from timestamptz not null,
  visit_to timestamptz not null,
  status text not null check (status in ('assigned','accepted','declined','done','cancelled')),
  emergency_rule_used boolean not null default false,
  contact_attempts jsonb not null default '[]' check (jsonb_typeof(contact_attempts) = 'array'),
  check (num_nonnulls(technician_profile_id, vendor_id) = 1),
  check (visit_to > visit_from),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, ticket_id) references maint.ticket(company_id, id),
  foreign key (company_id, technician_profile_id) references core.technician_profile(company_id, id),
  foreign key (company_id, vendor_id) references party.vendor(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('maint.dispatch');
--> statement-breakpoint
create index dispatch_ticket_id_idx on maint.dispatch(company_id, ticket_id);
--> statement-breakpoint
create index dispatch_technician_profile_id_idx on maint.dispatch(company_id, technician_profile_id);
--> statement-breakpoint
create index dispatch_vendor_id_idx on maint.dispatch(company_id, vendor_id);
--> statement-breakpoint
create table ai.model_call (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
purpose text not null,
  registry_entry text not null,
  provider text not null,
  model_id text not null,
  prompt_version text not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  output_sha256 text check (output_sha256 ~ '^[0-9a-f]{64}$'),
  output_key text,
  latency_ms integer not null check (latency_ms >= 0),
  tokens jsonb not null default '{}' check (jsonb_typeof(tokens) = 'object'),
  cost_micro_usd bigint not null check (cost_micro_usd >= 0),
  status text not null check (status in ('succeeded','failed')),
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_append_only_table('ai.model_call');
--> statement-breakpoint
create function ai.valid_extraction_fields(v jsonb) returns boolean language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(v) = 'object' then not exists (
    select 1 from jsonb_each(v) as field
    where not coalesce(
      jsonb_typeof(field.value) = 'object'
      and field.value - 'value' - 'confidence' - 'page' - 'evidence' = '{}'::jsonb
      and field.value ? 'value'
      and char_length((field.value->'value')::text) <= 2000
      and jsonb_typeof(field.value->'confidence') = 'number'
      and case when jsonb_typeof(field.value->'confidence') = 'number'
        then (field.value->>'confidence')::numeric between 0 and 1 else false end
      and jsonb_typeof(field.value->'page') = 'number'
      and case when jsonb_typeof(field.value->'page') = 'number'
        then (field.value->>'page')::numeric > 0 and mod((field.value->>'page')::numeric, 1) = 0 else false end
      and jsonb_typeof(field.value->'evidence') = 'string'
      and char_length(field.value->>'evidence') <= 2000, false)
  ) else false end
$$;
--> statement-breakpoint
grant execute on function ai.valid_extraction_fields(jsonb) to aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create table ai.extraction (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
document_version_id uuid not null,
  model_call_id uuid not null,
  schema_code text not null,
  fields jsonb not null check (ai.valid_extraction_fields(fields)),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, document_version_id) references doc.document_version(company_id, id),
  foreign key (company_id, model_call_id) references ai.model_call(company_id, id)
);
--> statement-breakpoint
select ops.register_append_only_table('ai.extraction');
--> statement-breakpoint
create index extraction_document_version_id_idx on ai.extraction(company_id, document_version_id);
--> statement-breakpoint
create index extraction_model_call_id_idx on ai.extraction(company_id, model_call_id);
--> statement-breakpoint
create trigger capture_version after insert on ai.model_call for each row execute function audit.capture_entity_version();
--> statement-breakpoint
revoke insert on ai.model_call from aqarak_app, aqarak_scheduler;
--> statement-breakpoint
grant select on ai.model_call to aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create trigger capture_version after insert on ai.extraction for each row execute function audit.capture_entity_version();
--> statement-breakpoint
revoke insert on ai.extraction from aqarak_app, aqarak_scheduler;
--> statement-breakpoint
grant select on ai.extraction to aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create table ai.drafted_action (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
for_account_id uuid not null references core.person_account(id),
  initiator text not null check (initiator in ('person','co_worker','pipeline','scheduler')),
  channel text not null check (channel in ('web_form','mobile_form','chat','voice','system','import')),
  command_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  base_versions jsonb not null default '{}' check (jsonb_typeof(base_versions) = 'object'),
  field_provenance jsonb not null default '{}' check (audit.valid_field_provenance(field_provenance)),
  extraction_id uuid,
  status text not null check (status in ('drafting','ready','committed','rejected','expired','failed')),
  failure_reason text,
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, extraction_id) references ai.extraction(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('ai.drafted_action');
--> statement-breakpoint
create index drafted_action_extraction_id_idx on ai.drafted_action(company_id, extraction_id);
--> statement-breakpoint
create index drafted_action_for_account_idx on ai.drafted_action(for_account_id);
--> statement-breakpoint
grant insert, update on ai.drafted_action to aqarak_pipeline;
