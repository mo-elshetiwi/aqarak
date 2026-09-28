alter table audit.audit_event drop column details;
--> statement-breakpoint
create or replace function audit.event_payload(e audit.audit_event) returns jsonb language sql stable strict security invoker
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_set(to_jsonb(e) - 'prev_hash' - 'row_hash' - 'canon_version',
    '{occurred_at}', coalesce(to_jsonb(to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'null'::jsonb))
$$;
--> statement-breakpoint
alter table audit.audit_event
  drop constraint audit_event_visibility_check,
  add constraint audit_event_visibility_check check (visibility in ('staff','parties','all')),
  alter column retention_class set default 'company_lifetime',
  add constraint audit_event_retention_class_check check (retention_class in ('company_lifetime','ninety_days')),
  add constraint audit_event_actor_role_check check (actor_role is null or actor_role in ('manager','owner','tenant','technician','company_administrator','accountant'));
--> statement-breakpoint
create function audit.valid_field_provenance(v jsonb) returns boolean language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(v) = 'object' then
    not exists (
      select 1 from jsonb_each_text(v)
      where value is null or value not in ('ai_confirmed','ai_edited','human_entered')
    )
  else false end
$$;
--> statement-breakpoint
alter table audit.audit_event
  add constraint audit_event_field_provenance_check check (field_provenance is null or audit.valid_field_provenance(field_provenance)),
  add constraint audit_event_policy_decision_check check (policy_decision is null or coalesce(
    jsonb_typeof(policy_decision) = 'object'
    and policy_decision ?& array['policy_version','result','reasons']
    and policy_decision - array['policy_version','result','reasons'] = '{}'::jsonb
    and jsonb_typeof(policy_decision->'policy_version') = 'string'
    and policy_decision->>'result' in ('allow','deny')
    and jsonb_typeof(policy_decision->'reasons') = 'array', false));
--> statement-breakpoint
grant execute on function audit.event_payload(audit.audit_event), audit.valid_field_provenance(jsonb) to aqarak_app, aqarak_pipeline, aqarak_scheduler;
