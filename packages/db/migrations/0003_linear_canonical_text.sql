create or replace function audit.canonical_text(v jsonb) returns text language plpgsql immutable strict
set search_path = pg_catalog, pg_temp
as $$
declare
  kind text := jsonb_typeof(v);
  result text;
  code integer;
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
      if position('"' in source) = 0
         and position(chr(92) in source) = 0
         and source !~ ('[' || chr(1) || '-' || chr(31) || ']') then
        result := '"' || source || '"';
      else
        source := replace(source, chr(92), chr(92) || chr(92));
        source := replace(source, '"', chr(92) || '"');
        source := replace(source, chr(8), chr(92) || 'b');
        source := replace(source, chr(12), chr(92) || 'f');
        source := replace(source, chr(10), chr(92) || 'n');
        source := replace(source, chr(13), chr(92) || 'r');
        source := replace(source, chr(9), chr(92) || 't');
        for code in 1..31 loop
          if code not in (8, 12, 10, 13, 9) then
            source := replace(source, chr(code), chr(92) || 'u00' || lpad(to_hex(code), 2, '0'));
          end if;
        end loop;
        result := '"' || source || '"';
      end if;
    else raise exception 'Unsupported canonical value';
  end case;
  return result;
end
$$;
