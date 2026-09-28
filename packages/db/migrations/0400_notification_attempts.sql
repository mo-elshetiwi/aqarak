create table work.notification_attempt (
  company_id uuid not null,
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null,
  outbox_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  outcome text not null check (outcome in ('sent','failed','dead_lettered')),
  provider_message_id text,
  error_code text,
  error_detail text check (char_length(error_detail) <= 300),
  occurred_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, notification_id, attempt_no),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, notification_id) references work.notification(company_id, id),
  foreign key (company_id, outbox_id) references ops.outbox(company_id, id)
);
--> statement-breakpoint
select ops.register_append_only_table('work.notification_attempt');
--> statement-breakpoint
revoke insert on work.notification_attempt from aqarak_app, aqarak_pipeline;
--> statement-breakpoint
create table lease.approval_context (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
  approval_id uuid not null,
  channel text not null check (channel in ('web_form','mobile_form')),
  device text not null check (char_length(device) <= 80),
  unique (company_id, id),
  unique (company_id, approval_id),
  foreign key (company_id) references core.company(id),
  foreign key (company_id, approval_id) references lease.approval(company_id, id)
);
--> statement-breakpoint
select ops.register_business_table('lease.approval_context');
