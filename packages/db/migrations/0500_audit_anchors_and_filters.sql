-- I retain the old payload for rows predating details, preserving their existing hashes.
alter table audit.audit_event add column details jsonb check (details is null or jsonb_typeof(details) = 'object');
--> statement-breakpoint
create or replace function audit.event_payload(e audit.audit_event) returns jsonb language sql stable strict security invoker
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_set(
    (case when e.details is null then to_jsonb(e) - 'details' else to_jsonb(e) end)
      - 'prev_hash' - 'row_hash' - 'canon_version',
    '{occurred_at}', coalesce(to_jsonb(to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'null'::jsonb))
$$;
--> statement-breakpoint
create table audit.chain_anchor (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references core.company(id),
  seq bigint not null check (seq > 0),
  head_hash text not null check (head_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null,
  s3_key text not null,
  s3_version_id text not null,
  object_sha256 text not null check (object_sha256 ~ '^[0-9a-f]{64}$'),
  anchored_at timestamptz not null default now(),
  anchored_by uuid references core.person_account(id),
  unique (company_id, seq, head_hash)
);
--> statement-breakpoint
select ops.register_append_only_table('audit.chain_anchor');
--> statement-breakpoint
revoke insert on audit.chain_anchor from aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create function audit.chain_head_of(p_company_id uuid) returns table (seq bigint, head_hash text)
language sql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
  select h.seq, h.head_hash from audit.chain_head h
  where h.company_id = p_company_id and p_company_id = ops.ctx_company_id()
  for update
$$;
--> statement-breakpoint
revoke all on function audit.chain_head_of(uuid) from public;
--> statement-breakpoint
grant execute on function audit.chain_head_of(uuid) to aqarak_app, aqarak_scheduler;
--> statement-breakpoint
create index audit_event_subject_idx on audit.audit_event(company_id, subject_type, subject_id, seq);
--> statement-breakpoint
create index audit_event_actor_idx on audit.audit_event(company_id, actor_account_id, seq);
--> statement-breakpoint
create index audit_event_type_idx on audit.audit_event(company_id, event_type, seq);
