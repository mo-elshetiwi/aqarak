create table doc.field_review (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.company(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  document_version_id uuid not null,
  extraction_id uuid,
  field_name text not null check (field_name in ('id_number','name_en','name_ar','nationality_en','nationality_ar','date_of_birth','sex','issue_date','expiry_date','card_number')),
  decision text not null check (decision in ('accepted','edited','not_on_document')),
  value text check (char_length(value) <= 2000),
  source_viewed boolean not null,
  provenance text not null check (provenance in ('ai_confirmed','ai_edited','human_entered')),
  check ((decision = 'not_on_document') = (value is null)),
  unique (company_id, id),
  unique (company_id, document_version_id, field_name),
  foreign key (company_id, document_version_id) references doc.document_version(company_id, id),
  foreign key (company_id, extraction_id) references ai.extraction(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('doc.field_review');
--> statement-breakpoint
alter table ai.extraction add constraint extraction_version_identity unique (company_id, document_version_id, id);
--> statement-breakpoint
alter table doc.field_review add constraint field_review_extraction_version_fk foreign key (company_id, document_version_id, extraction_id) references ai.extraction(company_id, document_version_id, id);
--> statement-breakpoint
do $$
declare constraint_name text;
begin
  select conname into strict constraint_name from pg_constraint
  where conrelid = 'party.tenant'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%signatory_eid%';
  execute format('alter table party.tenant drop constraint %I', constraint_name);
end
$$;
--> statement-breakpoint
alter table party.tenant add constraint tenant_signatory_eid_check check (signatory_eid ~ '^[0-9]{15}$');
--> statement-breakpoint
alter table doc.document_version add column file_name text check (char_length(file_name) between 1 and 255), add column uploaded_at timestamptz;
--> statement-breakpoint
create unique index tenant_identity_document_unique on doc.document(company_id, subject_id, doc_type) where subject_type = 'tenant' and doc_type in ('emirates_id','passport');
--> statement-breakpoint
create policy idempotency_extraction_pipeline on ops.idempotency_key to aqarak_pipeline
using (company_id = ops.ctx_company_id() and command_type = 'document.extraction')
with check (company_id = ops.ctx_company_id() and command_type = 'document.extraction');
--> statement-breakpoint
grant select on ops.idempotency_key to aqarak_pipeline;
--> statement-breakpoint
grant update (response) on ops.idempotency_key to aqarak_pipeline;
--> statement-breakpoint
create or replace function ai.valid_extraction_fields(v jsonb) returns boolean language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(v) = 'object' then not exists (
    select 1 from jsonb_each(v) as field
    where not coalesce(
      jsonb_typeof(field.value) = 'object'
      and field.value - 'value' - 'confidence' - 'page' - 'evidence' = '{}'::jsonb
      and field.value ?& array['value','confidence','page','evidence']
      and jsonb_typeof(field.value->'value') in ('string','null')
      and char_length(coalesce(field.value->>'value','')) <= 2000
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
