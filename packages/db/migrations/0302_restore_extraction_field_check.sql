create or replace function ai.valid_extraction_fields(v jsonb) returns boolean language sql immutable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(v) = 'object' then not exists (
    select 1 from jsonb_each(v) as field
    where not coalesce(
      jsonb_typeof(field.value) = 'object'
      and field.value - 'value' - 'confidence' - 'page' - 'evidence' = '{}'::jsonb
      and field.value ? 'value'
      and char_length((field.value->'value')::text) <= 2000
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
