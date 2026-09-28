create table ops.idempotency_key (
  company_id uuid not null references core.company(id),
  account_id uuid not null references core.person_account(id),
  command_type text not null,
  key text not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  response jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, account_id, command_type, key)
);
--> statement-breakpoint
alter table ops.idempotency_key enable row level security;
--> statement-breakpoint
alter table ops.idempotency_key force row level security;
--> statement-breakpoint
create policy idempotency_app on ops.idempotency_key to aqarak_app using (company_id = ops.ctx_company_id() and account_id = ops.ctx_account_id()) with check (company_id = ops.ctx_company_id() and account_id = ops.ctx_account_id());
--> statement-breakpoint
create policy idempotency_housekeeping_read on ops.idempotency_key for select to aqarak_scheduler using (created_at < now() - interval '7 days');
--> statement-breakpoint
create policy idempotency_housekeeping_delete on ops.idempotency_key for delete to aqarak_scheduler using (created_at < now() - interval '7 days');
--> statement-breakpoint
revoke all on ops.idempotency_key from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant select, insert on ops.idempotency_key to aqarak_app;
--> statement-breakpoint
grant update (response) on ops.idempotency_key to aqarak_app;
--> statement-breakpoint
grant select, delete on ops.idempotency_key to aqarak_scheduler;
--> statement-breakpoint
create index idempotency_key_created_idx on ops.idempotency_key(created_at);
--> statement-breakpoint
create index idempotency_key_account_idx on ops.idempotency_key(account_id);
--> statement-breakpoint
create trigger z_row_size before insert or update on ops.idempotency_key for each row execute function ops.check_row_size();
--> statement-breakpoint
create table ops.outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid,
topic text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null unique,
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  last_error text,
  dead_lettered_at timestamptz,
  unique (company_id, id),
  foreign key (company_id) references core.company(id)
);
--> statement-breakpoint
select ops.register_business_table('ops.outbox');
--> statement-breakpoint
revoke all on ops.outbox from aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant insert on ops.outbox to aqarak_app;
--> statement-breakpoint
grant select, insert, update on ops.outbox to aqarak_scheduler;
--> statement-breakpoint
create index outbox_available_idx on ops.outbox(company_id, available_at) where sent_at is null and dead_lettered_at is null;
--> statement-breakpoint
create table ops.number_series (
  company_id uuid not null references core.company(id),
  series text not null check (series in ('INV','CN','RCPT','STMT')),
  next_value bigint not null default 1 check (next_value > 0),
  primary key (company_id, series)
);
--> statement-breakpoint
alter table ops.number_series enable row level security;
--> statement-breakpoint
alter table ops.number_series force row level security;
--> statement-breakpoint
create policy company_isolation on ops.number_series using (company_id = ops.ctx_company_id()) with check (company_id = ops.ctx_company_id());
--> statement-breakpoint
revoke all on ops.number_series from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create trigger reject_delete before delete or truncate on ops.number_series for each statement execute function ops.reject_mutation();
--> statement-breakpoint
create function ops.next_number(p_series text) returns bigint language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  company uuid := ops.ctx_company_id();
  result bigint;
begin
  if company is null then
    raise exception using errcode = 'AQ001', message = 'Company context is required';
  end if;
  if p_series is null or p_series not in ('INV','CN','RCPT','STMT') then
    raise exception using errcode = '23514', message = 'Unknown number series';
  end if;
  insert into ops.number_series(company_id, series) values (company, p_series) on conflict do nothing;
  select next_value into strict result from ops.number_series
    where company_id = company and series = p_series for update;
  update ops.number_series set next_value = result + 1 where company_id = company and series = p_series;
  return result;
end
$$;
--> statement-breakpoint
create function ops.format_number(series text, n bigint) returns text language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select series || '-' || lpad(n::text, greatest(6, length(n::text)), '0')
$$;
--> statement-breakpoint
grant execute on function ops.next_number(text), ops.format_number(text, bigint) to aqarak_app;
--> statement-breakpoint
create table ops.processed_event (
  bucket text not null,
  s3_key text not null,
  s3_version_id text not null,
  scan_result text not null,
  processed_at timestamptz not null default now(),
  unique (bucket, s3_key, s3_version_id, scan_result)
);
--> statement-breakpoint
alter table ops.processed_event enable row level security;
--> statement-breakpoint
alter table ops.processed_event force row level security;
--> statement-breakpoint
create policy processed_event_read on ops.processed_event for select to aqarak_pipeline using (true);
--> statement-breakpoint
create policy processed_event_insert on ops.processed_event for insert to aqarak_pipeline with check (true);
--> statement-breakpoint
revoke all on ops.processed_event from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
grant select, insert on ops.processed_event to aqarak_pipeline;
--> statement-breakpoint
create trigger reject_mutation before update or delete or truncate on ops.processed_event for each statement execute function ops.reject_mutation();
--> statement-breakpoint
create trigger z_row_size before insert on ops.processed_event for each row execute function ops.check_row_size();
