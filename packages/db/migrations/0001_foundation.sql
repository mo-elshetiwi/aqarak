do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migrations require the database owner';
  end if;
end
$$;
--> statement-breakpoint
create extension if not exists btree_gist;
--> statement-breakpoint
create extension if not exists pg_trgm;
--> statement-breakpoint
revoke create on schema public from public;
--> statement-breakpoint
do $$
declare n text;
begin
  foreach n in array array['core','party','estate','lease','money','maint','doc','work','ai','audit','ops'] loop
    execute format('create schema if not exists %I authorization postgres', n);
    execute format('revoke all on schema %I from public', n);
  end loop;
  foreach n in array array['aqarak_app','aqarak_pipeline','aqarak_scheduler'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = n) then
      execute format('create role %I nologin nosuperuser nobypassrls nocreatedb nocreaterole inherit', n);
    end if;
  end loop;
end
$$;
--> statement-breakpoint
alter default privileges for role postgres revoke execute on functions from public;
--> statement-breakpoint
grant usage on schema core, party, estate, lease, money, maint, doc, work, ai, audit, ops to aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
revoke all on ops.schema_migration from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create function ops.ctx_company_id() returns uuid language sql stable
as $$ select nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
create function ops.ctx_account_id() returns uuid language sql stable
as $$ select nullif(current_setting('app.account_id', true), '')::uuid $$;
--> statement-breakpoint
grant execute on function ops.ctx_company_id(), ops.ctx_account_id() to aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create function ops.reject_mutation() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception using errcode = 'AQ003', message = 'Append-only or no-delete violation';
end
$$;
--> statement-breakpoint
create function ops.check_row_size() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare row_json jsonb := to_jsonb(NEW);
begin
  if TG_TABLE_SCHEMA = 'core' and TG_TABLE_NAME = 'company' then
    row_json := jsonb_set(row_json, '{company_id}', row_json->'id');
  end if;
  if octet_length(row_json::text) > 49152 then
    raise exception using errcode = 'AQ004', message = 'Row exceeds 48 KiB';
  end if;
  return NEW;
end
$$;
--> statement-breakpoint
create function ops.stamp_update() returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if NEW.id is distinct from OLD.id
     or (TG_TABLE_NAME <> 'company' and (to_jsonb(NEW)->>'company_id') is distinct from (to_jsonb(OLD)->>'company_id'))
     or NEW.created_at is distinct from OLD.created_at
     or NEW.created_by is distinct from OLD.created_by then
    raise exception using errcode = 'AQ003', message = 'Immutable identity or creation stamp';
  end if;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by := ops.ctx_account_id();
  return NEW;
end
$$;
--> statement-breakpoint
create function audit.canonical_text(v jsonb) returns text language plpgsql immutable strict
set search_path = pg_catalog, pg_temp
as $$
declare
  kind text := jsonb_typeof(v);
  result text;
  ch text;
  code integer;
  i integer;
  source text;
begin
  case kind
    when 'object' then
      select '{' || coalesce(string_agg(audit.canonical_text(to_jsonb(key)) || ':' || audit.canonical_text(value), ',' order by key collate "C"), '') || '}'
        into result from jsonb_each(v);
    when 'array' then
      select '[' || coalesce(string_agg(audit.canonical_text(value), ',' order by ordinal), '') || ']'
        into result from jsonb_array_elements(v) with ordinality as a(value, ordinal);
    when 'number' then
      result := '"' || trim_scale((v #>> '{}')::numeric)::text || '"';
    when 'boolean' then result := v #>> '{}';
    when 'null' then result := 'null';
    when 'string' then
      source := v #>> '{}';
      result := '"';
      for i in 1..char_length(source) loop
        ch := substr(source, i, 1);
        code := ascii(ch);
        case
          when ch = '"' then result := result || chr(92) || '"';
          when ch = chr(92) then result := result || chr(92) || chr(92);
          when code = 8 then result := result || chr(92) || 'b';
          when code = 12 then result := result || chr(92) || 'f';
          when code = 10 then result := result || chr(92) || 'n';
          when code = 13 then result := result || chr(92) || 'r';
          when code = 9 then result := result || chr(92) || 't';
          when code between 1 and 31 then result := result || chr(92) || 'u00' || lpad(to_hex(code), 2, '0');
          else result := result || ch;
        end case;
      end loop;
      result := result || '"';
    else raise exception 'Unsupported canonical value';
  end case;
  return result;
end
$$;
--> statement-breakpoint
create table audit.chain_head (
  company_id uuid primary key,
  seq bigint not null check (seq >= 0),
  head_hash text not null check (head_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null
);
--> statement-breakpoint
alter table audit.chain_head enable row level security;
--> statement-breakpoint
alter table audit.chain_head force row level security;
--> statement-breakpoint
create policy company_isolation on audit.chain_head using (company_id = ops.ctx_company_id()) with check (company_id = ops.ctx_company_id());
--> statement-breakpoint
revoke all on audit.chain_head from public, aqarak_app, aqarak_pipeline, aqarak_scheduler;
--> statement-breakpoint
create table audit.audit_event (
  event_id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  seq bigint not null,
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  actor_account_id uuid,
  actor_role text,
  on_behalf_of uuid,
  initiator text not null check (initiator in ('person','co_worker','pipeline','scheduler')),
  channel text not null check (channel in ('web_form','mobile_form','chat','voice','system','import')),
  subject_type text not null,
  subject_id uuid not null,
  version_before integer,
  version_after integer,
  changed_fields jsonb not null default '[]' check (jsonb_typeof(changed_fields) = 'array'),
  before_hash text check (before_hash ~ '^[0-9a-f]{64}$'),
  after_hash text check (after_hash ~ '^[0-9a-f]{64}$'),
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  canon_version text not null default 'AQ-CANON-1' check (canon_version = 'AQ-CANON-1'),
  reason text,
  drafted_action_id uuid,
  field_provenance jsonb,
  model_call_ids jsonb not null default '[]' check (jsonb_typeof(model_call_ids) = 'array'),
  registry_entry text,
  prompt_version text,
  tool_version text,
  policy_decision jsonb,
  idempotency_key text,
  trace_id text,
  visibility text not null default 'staff' check (visibility in ('staff','parties')),
  retention_class text not null default 'standard',
  details jsonb not null default '{}',
  tx_id bigint not null,
  unique (company_id, seq),
  unique (company_id, event_id),
  check (event_type !~ '(changes_requested|withdrawn|cancelled|returned|skipped|voided|waived|rejected|discrepancy_resolved)$' or nullif(btrim(reason), '') is not null),
  check (initiator not in ('co_worker','pipeline') or subject_type in ('drafted_action','extraction','model_call') or (drafted_action_id is not null and field_provenance is not null))
);
--> statement-breakpoint
create table audit.entity_version (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  subject_version integer not null,
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  tx_id bigint not null,
  recorded_at timestamptz not null default now(),
  unique (company_id, subject_type, subject_id, subject_version)
);
--> statement-breakpoint
create table audit.event_subject (
  company_id uuid not null,
  event_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  subject_version integer not null,
  unique (company_id, subject_type, subject_id, subject_version),
  foreign key (company_id, event_id) references audit.audit_event (company_id, event_id)
);
--> statement-breakpoint
create index event_subject_event_idx on audit.event_subject (company_id, event_id);
--> statement-breakpoint
create function ops.register_append_only_table(t regclass) returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format('create policy company_isolation on %s using (company_id = ops.ctx_company_id()) with check (company_id = ops.ctx_company_id())', t);
  execute format('create trigger reject_mutation before update or delete or truncate on %s for each statement execute function ops.reject_mutation()', t);
  execute format('create trigger z_row_size before insert on %s for each row execute function ops.check_row_size()', t);
  execute format('revoke all on %s from public, aqarak_app, aqarak_pipeline, aqarak_scheduler', t);
  execute format('grant select, insert on %s to aqarak_app', t);
  execute format('grant insert on %s to aqarak_pipeline, aqarak_scheduler', t);
end
$$;
--> statement-breakpoint
select ops.register_append_only_table('audit.audit_event');
--> statement-breakpoint
select ops.register_append_only_table('audit.entity_version');
--> statement-breakpoint
select ops.register_append_only_table('audit.event_subject');
--> statement-breakpoint
create function audit.event_payload(e audit.audit_event) returns jsonb language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_set(to_jsonb(e) - 'prev_hash' - 'row_hash' - 'canon_version' - 'tx_id',
    '{occurred_at}', to_jsonb(to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
$$;
--> statement-breakpoint
create function audit.prepare_event() returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare h audit.chain_head%rowtype;
begin
  if NEW.actor_account_id is distinct from ops.ctx_account_id() then
    raise exception using errcode = 'AQ001', message = 'Audit actor mismatch';
  end if;
  NEW.tx_id := pg_current_xact_id()::text::bigint;
  insert into audit.chain_head(company_id, seq, head_hash, updated_at)
    values (NEW.company_id, 0, repeat('0', 64), now()) on conflict do nothing;
  select * into strict h from audit.chain_head where company_id = NEW.company_id for update;
  NEW.seq := h.seq + 1;
  NEW.prev_hash := h.head_hash;
  if NEW.version_before is not null and NEW.before_hash is null then
    select snapshot_sha256 into NEW.before_hash from audit.entity_version
      where company_id = NEW.company_id and subject_type = NEW.subject_type and subject_id = NEW.subject_id and subject_version = NEW.version_before;
  end if;
  if NEW.version_after is not null and NEW.after_hash is null then
    select snapshot_sha256 into NEW.after_hash from audit.entity_version
      where company_id = NEW.company_id and subject_type = NEW.subject_type and subject_id = NEW.subject_id and subject_version = NEW.version_after;
  end if;
  NEW.row_hash := encode(sha256(convert_to(NEW.prev_hash || '|' || NEW.canon_version || '|' || audit.canonical_text(audit.event_payload(NEW)), 'UTF8')), 'hex');
  update audit.chain_head set seq = NEW.seq, head_hash = NEW.row_hash, updated_at = now() where company_id = NEW.company_id;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger a_prepare_event before insert on audit.audit_event for each row execute function audit.prepare_event();
--> statement-breakpoint
create function audit.cover_primary_subject() returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if NEW.version_after is not null then
    insert into audit.event_subject(company_id, event_id, subject_type, subject_id, subject_version)
      values (NEW.company_id, NEW.event_id, NEW.subject_type, NEW.subject_id, NEW.version_after);
  end if;
  return NEW;
end
$$;
--> statement-breakpoint
create trigger cover_primary_subject after insert on audit.audit_event for each row execute function audit.cover_primary_subject();
--> statement-breakpoint
create function audit.check_coverage() returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare covering bigint;
begin
  select count(*) into covering from audit.event_subject s
    join audit.audit_event e on e.company_id = s.company_id and e.event_id = s.event_id
    where s.company_id = NEW.company_id and s.subject_type = NEW.subject_type
      and s.subject_id = NEW.subject_id and s.subject_version = NEW.subject_version and e.tx_id = NEW.tx_id;
  if covering <> 1 then
    raise exception using errcode = 'AQ002', message = 'Entity version requires exactly one covering audit event in the same transaction';
  end if;
  return NEW;
end
$$;
--> statement-breakpoint
create constraint trigger entity_version_coverage after insert on audit.entity_version
  deferrable initially deferred for each row execute function audit.check_coverage();
--> statement-breakpoint
create function audit.capture_entity_version() returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare snap jsonb := to_jsonb(NEW);
begin
  insert into audit.entity_version(company_id, subject_type, subject_id, subject_version, snapshot, snapshot_sha256, tx_id)
    values (coalesce((snap->>'company_id')::uuid, ops.ctx_company_id()), TG_TABLE_NAME, NEW.id, NEW.version,
      snap, encode(sha256(convert_to(audit.canonical_text(snap), 'UTF8')), 'hex'), pg_current_xact_id()::text::bigint);
  return NEW;
end
$$;
--> statement-breakpoint
create function ops.register_business_table(t regclass) returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format('create policy company_isolation on %s using (company_id = ops.ctx_company_id()) with check (company_id = ops.ctx_company_id())', t);
  execute format('create trigger a_stamp_update before update on %s for each row execute function ops.stamp_update()', t);
  execute format('create trigger z_row_size before insert or update on %s for each row execute function ops.check_row_size()', t);
  execute format('create trigger capture_version after insert or update on %s for each row execute function audit.capture_entity_version()', t);
  execute format('create trigger reject_delete before delete or truncate on %s for each statement execute function ops.reject_mutation()', t);
  execute format('revoke all on %s from public, aqarak_app, aqarak_pipeline, aqarak_scheduler', t);
  execute format('grant select, insert, update on %s to aqarak_app', t);
  execute format('grant select on %s to aqarak_pipeline, aqarak_scheduler', t);
end
$$;
--> statement-breakpoint
create function audit.verify_chain(p_company_id uuid)
returns table (ok boolean, first_bad_seq bigint, problem text) language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  expected_seq bigint := 1;
  previous_hash text := repeat('0', 64);
  e audit.audit_event%rowtype;
  h audit.chain_head%rowtype;
  computed text;
begin
  if p_company_id is distinct from ops.ctx_company_id() then
    return query select false, null::bigint, 'Company context mismatch'::text;
    return;
  end if;
  -- One statement snapshot covers both the events and the head during verification.
  for e in select * from audit.audit_event where company_id = p_company_id order by seq loop
    if e.seq <> expected_seq then
      return query select false, expected_seq, 'Sequence gap'::text; return;
    end if;
    if e.prev_hash <> previous_hash then
      return query select false, e.seq, 'Previous hash mismatch'::text; return;
    end if;
    computed := encode(sha256(convert_to(e.prev_hash || '|' || e.canon_version || '|' || audit.canonical_text(audit.event_payload(e)), 'UTF8')), 'hex');
    if computed <> e.row_hash then
      return query select false, e.seq, 'Row hash mismatch'::text; return;
    end if;
    previous_hash := e.row_hash;
    expected_seq := expected_seq + 1;
  end loop;
  select * into h from audit.chain_head where company_id = p_company_id;
  if not found then
    if expected_seq <> 1 then
      return query select false, expected_seq - 1, 'Chain head missing'::text; return;
    end if;
  elsif h.seq <> expected_seq - 1 then
    return query select false, least(h.seq, expected_seq - 1) + 1, 'Chain head mismatch or truncation'::text; return;
  elsif h.head_hash <> previous_hash then
    return query select false, h.seq, 'Chain head hash mismatch'::text; return;
  end if;
  return query select true, null::bigint, null::text;
end
$$;
--> statement-breakpoint
grant execute on function audit.canonical_text(jsonb), audit.event_payload(audit.audit_event), audit.verify_chain(uuid) to aqarak_app, aqarak_pipeline, aqarak_scheduler;
