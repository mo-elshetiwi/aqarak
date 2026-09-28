import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadMigrations, splitStatements } from "./migrate.ts";

it("aligns audit content through a forward migration without unhashed columns", async () => {
  const sql = await readFile(
    new URL(
      "../migrations/0004_align_audit_event_content.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(sql).toMatch(/alter table audit\.audit_event drop column details;/u);
  const payload = splitStatements(sql).find((statement) =>
    statement.startsWith("create or replace function audit.event_payload("),
  );
  expect(payload).toBeDefined();
  if (!payload) throw new Error("Audit payload replacement is missing");
  expect(
    [...payload.matchAll(/- '([a-z_]+)'/gu)].map((match) => match[1]),
  ).toEqual(["prev_hash", "row_hash", "canon_version"]);
  expect(payload).toContain("to_jsonb(e)");
  expect(payload).toContain("language sql stable strict security invoker");
  expect(payload).toContain("set search_path = pg_catalog, pg_temp");
  expect(payload).toContain("at time zone 'UTC'");
  expect(payload).toContain('YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  expect(sql).toContain("visibility in ('staff','parties','all')");
  expect(sql).toContain("retention_class set default 'company_lifetime'");
  expect(sql).toContain(
    "retention_class in ('company_lifetime','ninety_days')",
  );
  expect(sql).toContain(
    "actor_role is null or actor_role in ('manager','owner','tenant','technician','company_administrator','accountant')",
  );
  expect(sql).toContain("jsonb_each_text(v)");
  expect(sql).toContain(
    "value is null or value not in ('ai_confirmed','ai_edited','human_entered')",
  );
  expect(sql).toContain(
    "policy_decision ?& array['policy_version','result','reasons']",
  );
  expect(sql).toContain(
    "policy_decision - array['policy_version','result','reasons'] = '{}'::jsonb",
  );
  expect(sql).toContain("policy_decision->>'result' in ('allow','deny')");
  expect(sql).toContain("jsonb_typeof(policy_decision->'reasons') = 'array'");
  expect(sql).toContain(
    "grant execute on function audit.event_payload(audit.audit_event), audit.valid_field_provenance(jsonb) to aqarak_app, aqarak_pipeline, aqarak_scheduler",
  );
  expect(sql).not.toMatch(/drop constraint audit_event_model_call_ids_check/u);
});

it("AC-6 registers all company tables, constrains statuses and uses supported column types", async () => {
  const migrations = await loadMigrations(
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );
  const sql = migrations
    .map((file) => file.sql)
    .join("\n--> statement-breakpoint\n");
  const names = new Set<string>();
  const expected = new Set<string>();
  const registered = new Set(
    [
      ...sql.matchAll(
        /select ops\.register_(?:business|append_only|account)_table\('([^']+)'\)/gu,
      ),
    ].map((match) => match[1]),
  );
  for (const statement of splitStatements(sql)) {
    const table =
      /^create table ((?:core|party|estate|lease|money|maint|doc|work|ai|audit|ops)\.([a-z_]+))\s*\(/iu.exec(
        statement,
      );
    if (!table?.[1] || !table[2]) continue;
    expect(names.has(table[2])).toBe(false);
    names.add(table[2]);
    if (table[1] === "audit.chain_head") {
      expect(sql).toContain(
        "alter table audit.chain_head force row level security",
      );
      continue;
    }
    if (
      [
        "lease.contract_template",
        "lease.clause",
        "ops.idempotency_key",
        "ops.number_series",
        "ops.processed_event",
        "ops.auth_session",
        "ops.security_event",
      ].includes(table[1])
    ) {
      expect(sql).toContain(`alter table ${table[1]} force row level security`);
      continue;
    }
    expected.add(table[1]);
    const registration = new RegExp(
      `select ops\\.register_(?:business|append_only|account)_table\\('${table[1].replace(".", "\\.")}'\\)`,
      "u",
    );
    expect(sql.slice(sql.indexOf(statement))).toMatch(registration);
    for (const line of statement
      .split("\n")
      .filter((value) => /^\s*(?:\w+_)?status\s/iu.test(value)))
      expect(line).toMatch(/check\s*\([^()]*\bin\s*\(/iu);
    expect(statement).not.toMatch(/\bbytea\b|\w+\s*\[\s*\]/iu);
  }
  expect(expected.size).toBeGreaterThan(0);
  expect(registered).toEqual(expected);
  expect(sql).not.toMatch(/create\s+type\s+\S+\s+as\s+enum/iu);
  expect(sql).not.toMatch(
    /grant\s+(?:delete|truncate|references)|set_config\([^;]*,\s*false\)|\bset\s+role\b/iu,
  );
});
it("hardens every security-definer function and keeps registration owner-only", async () => {
  const sql = await readFile(
    new URL("../migrations/0001_foundation.sql", import.meta.url),
    "utf8",
  );
  for (const statement of splitStatements(sql).filter((value) =>
    value.includes("security definer"),
  ))
    expect(statement).toContain("set search_path = pg_catalog, pg_temp");
  expect(sql).toContain(
    "alter default privileges for role postgres revoke execute on functions from public",
  );
  expect(sql).not.toMatch(/grant execute on function ops\.register/u);
});
