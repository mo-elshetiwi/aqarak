create table maint.media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  unit_id uuid not null,
  kind text not null check (kind in ('photo','voice_note')),
  uploaded_by_account_id uuid not null references core.person_account(id),
  bucket text not null,
  s3_key text not null,
  s3_version_id text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  content_type text not null,
  duration_ms integer,
  processing_status text not null default 'awaiting_upload' check (processing_status in ('awaiting_upload','uploaded','scan_clean','scan_rejected')),
  upload_expires_at timestamptz not null,
  drafted_action_id uuid,
  ticket_id uuid,
  check (
    (kind = 'photo' and content_type in ('image/jpeg','image/png') and byte_size <= 20971520 and duration_ms is null)
    or (kind = 'voice_note' and content_type in ('audio/mp4','audio/m4a','audio/aac','audio/mpeg','audio/wav','audio/webm') and byte_size <= 26214400 and duration_ms between 0 and 300000)
  ),
  unique (company_id, id),
  unique (bucket, s3_key),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, unit_id) references estate.unit(company_id, id),
  foreign key (company_id, drafted_action_id) references ai.drafted_action(company_id, id),
  foreign key (company_id, ticket_id) references maint.ticket(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('maint.media');
--> statement-breakpoint
create index media_unit_id_idx on maint.media(company_id, unit_id);
--> statement-breakpoint
create index media_drafted_action_id_idx on maint.media(company_id, drafted_action_id);
--> statement-breakpoint
create index media_ticket_id_idx on maint.media(company_id, ticket_id);
--> statement-breakpoint
create index media_uploaded_by_account_idx on maint.media(uploaded_by_account_id);
--> statement-breakpoint
create table maint.ticket_intake (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  ticket_id uuid not null,
  drafted_action_id uuid not null,
  channel text not null check (channel in ('mobile_form','voice')),
  report_language text not null check (report_language in ('en','ar')),
  transcript text check (char_length(transcript) <= 8000),
  transcript_edited boolean not null default false,
  safety_flags jsonb not null default '[]' check (jsonb_typeof(safety_flags) = 'array' and safety_flags <@ '["gas_smell","electrical_sparking","water_into_electrics","lift_entrapment","other_safety_hazard"]'::jsonb),
  transcription_mode text not null check (transcription_mode in ('model','degraded','not_requested')),
  triage_mode text not null check (triage_mode in ('model','degraded')),
  unique (company_id, id),
  unique (company_id, ticket_id),
  unique (company_id, drafted_action_id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, ticket_id) references maint.ticket(company_id, id),
  foreign key (company_id, drafted_action_id) references ai.drafted_action(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('maint.ticket_intake');
--> statement-breakpoint
create table maint.intake_model_call (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  drafted_action_id uuid not null,
  media_id uuid,
  class_id text not null check (class_id in ('mc3_speech_to_text','mc4_photo_triage')),
  candidate_id text,
  provider text,
  model_id text,
  prompt_id text,
  prompt_version integer,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  output_sha256 text check (output_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('ok','schema_invalid','refused','incomplete','provider_error','timeout','budget_stopped')),
  error_code text,
  latency_ms integer not null check (latency_ms >= 0),
  cost_micro_usd bigint not null check (cost_micro_usd >= 0),
  unique (company_id, id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, drafted_action_id) references ai.drafted_action(company_id, id),
  foreign key (company_id, media_id) references maint.media(company_id, id)
);
--> statement-breakpoint
select ops.register_append_only_table('maint.intake_model_call');
--> statement-breakpoint
create index intake_model_call_drafted_action_idx on maint.intake_model_call(company_id, drafted_action_id);
--> statement-breakpoint
create index intake_model_call_media_idx on maint.intake_model_call(company_id, media_id);
--> statement-breakpoint
create trigger capture_version after insert on maint.intake_model_call for each row execute function audit.capture_entity_version();
--> statement-breakpoint
create policy maint_account_subject_read on core.person_account for select to aqarak_app using (auth_subject = nullif(current_setting('app.auth_subject', true), ''));
