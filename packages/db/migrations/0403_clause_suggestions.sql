create table lease.clause_suggestion (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.company(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  contract_id uuid not null,
  requested_by uuid not null references core.person_account(id),
  registry_entry text not null,
  prompt_version text not null,
  text_en_sha256 text not null check (text_en_sha256 ~ '^[0-9a-f]{64}$'),
  text_ar text not null check (char_length(text_ar) between 1 and 2000),
  text_ar_sha256 text not null check (text_ar_sha256 ~ '^[0-9a-f]{64}$'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  unique (company_id, id),
  foreign key (company_id, contract_id) references lease.contract(company_id, id)
);
--> statement-breakpoint
create index clause_suggestion_contract_idx on lease.clause_suggestion(company_id, contract_id);
--> statement-breakpoint
select ops.register_business_table('lease.clause_suggestion');
