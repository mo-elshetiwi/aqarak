create table ops.auth_session (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  auth_subject text not null,
  client text not null check (client in ('web','mobile')),
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  email text not null,
  display_name text not null,
  locale text not null check (locale in ('en','ar')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('sign_out','expired','deactivated')),
  check (idle_expires_at <= expires_at)
);
--> statement-breakpoint
alter table ops.auth_session enable row level security;
--> statement-breakpoint
alter table ops.auth_session force row level security;
--> statement-breakpoint
create policy auth_session_lookup on ops.auth_session for select to aqarak_app using (session_hash = current_setting('app.session_hash', true));
--> statement-breakpoint
create policy auth_session_own on ops.auth_session to aqarak_app using (account_id = ops.ctx_account_id()) with check (account_id = ops.ctx_account_id());
--> statement-breakpoint
revoke all on ops.auth_session from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant select, insert on ops.auth_session to aqarak_app;
--> statement-breakpoint
grant update (last_seen_at, idle_expires_at, revoked_at, revoke_reason) on ops.auth_session to aqarak_app;
--> statement-breakpoint
create trigger reject_delete before delete or truncate on ops.auth_session for each statement execute function ops.reject_mutation();
--> statement-breakpoint
create trigger z_row_size before insert or update on ops.auth_session for each row execute function ops.check_row_size();
--> statement-breakpoint
create index auth_session_account_idx on ops.auth_session(account_id);
--> statement-breakpoint
create table ops.security_event (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  account_id uuid,
  event_type text not null check (event_type in ('sign_up','sign_up_confirmed','sign_in','sign_in_refused','token_refreshed','sign_out','session_expired','token_revoke_failed','company_create_refused','access_refused')),
  client text check (client in ('web','mobile')),
  session_id uuid,
  email_sha256 text check (email_sha256 ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object')
);
--> statement-breakpoint
alter table ops.security_event enable row level security;
--> statement-breakpoint
alter table ops.security_event force row level security;
--> statement-breakpoint
create policy security_event_insert on ops.security_event for insert to aqarak_app with check (account_id is null or account_id = ops.ctx_account_id());
--> statement-breakpoint
create policy security_event_select on ops.security_event for select to aqarak_app using (account_id = ops.ctx_account_id());
--> statement-breakpoint
revoke all on ops.security_event from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant select, insert on ops.security_event to aqarak_app;
--> statement-breakpoint
create trigger reject_mutation before update or delete or truncate on ops.security_event for each statement execute function ops.reject_mutation();
--> statement-breakpoint
create trigger z_row_size before insert on ops.security_event for each row execute function ops.check_row_size();
--> statement-breakpoint
create index security_event_account_idx on ops.security_event(account_id, occurred_at);
--> statement-breakpoint
alter table core.invitation
  add column staff_roles jsonb not null default '[]' check (jsonb_typeof(staff_roles) = 'array'),
  add column locale text not null default 'en' check (locale in ('en','ar')),
  add column delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed','not_configured')),
  add column delivery_attempted_at timestamptz,
  add column delivery_error text check (char_length(delivery_error) <= 200),
  add column accepted_account_id uuid references core.person_account(id),
  add column accepted_at timestamptz;
--> statement-breakpoint
create unique index invitation_pending_idx on core.invitation(company_id, email, kind, coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending';
