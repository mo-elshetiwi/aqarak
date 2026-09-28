alter table lease.tawtheeq_record
  add column attested_on date,
  add column attested_by uuid references core.person_account(id),
  add column return_reason text,
  add column closure_kind text check (closure_kind in ('portal_close','cancellation','renewal','court_termination')),
  add column closure_reason text;
--> statement-breakpoint
alter table lease.discrepancy drop constraint discrepancy_status_check;
--> statement-breakpoint
alter table lease.discrepancy add constraint discrepancy_status_check check (status in ('open','resolved','superseded'));
--> statement-breakpoint
create table lease.tawtheeq_review (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.company(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  tawtheeq_record_id uuid not null,
  document_version_id uuid not null,
  extraction_id uuid,
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  outcome text not null check (outcome in ('matched','discrepancies','identity_rejected')),
  reviewed_by uuid not null references core.person_account(id),
  unique (company_id, id),
  foreign key (company_id, tawtheeq_record_id) references lease.tawtheeq_record(company_id, id),
  foreign key (company_id, document_version_id) references doc.document_version(company_id, id),
  foreign key (company_id, extraction_id) references ai.extraction(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.tawtheeq_review');
--> statement-breakpoint
create index tawtheeq_review_record_idx on lease.tawtheeq_review(company_id, tawtheeq_record_id);
