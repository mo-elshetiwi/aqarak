import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadMigrations, splitStatements } from "./migrate.ts";

const directory = fileURLToPath(new URL("../migrations", import.meta.url));

function expectTableRegistration(
  statements: readonly string[],
  position: number,
  table: string,
): void {
  const escapedTable = table.replace(".", "\\.");
  const index = new RegExp(
    `^create (?:unique )?index \\w+ on ${escapedTable}(?:\\s+using \\w+)?\\s*\\([^;]+\\)[^;]*;$`,
    "u",
  );
  let next = position + 1;
  while (index.test(statements[next] ?? "")) next += 1;
  expect(statements[next], table).toMatch(
    new RegExp(
      `^select ops\\.register_(?:business|append_only)_table\\('${escapedTable}'\\);$`,
      "u",
    ),
  );
}

it("AC-1 registers business rows immediately and indexes company foreign keys", async () => {
  const migrations = await loadMigrations(directory);
  const all = migrations.map((file) => file.sql).join("\n");
  for (const file of migrations.filter((file) => file.name >= "0005")) {
    const statements = splitStatements(file.sql);
    for (const [position, statement] of statements.entries()) {
      const match = /^create table ([a-z_]+\.[a-z_]+)\s*\(/u.exec(statement);
      const table = match?.[1];
      if (!table) continue;
      expect(statement, table).not.toMatch(/\bbytea\b|\w+\s*\[\s*\]/iu);
      for (const line of statement.split("\n")) {
        if (/^\s*\w*status\s/u.test(line))
          expect(line, table).toMatch(/check\s*\([^()]*\bin\s*\(/iu);
      }
      if (table.startsWith("ops.") && table !== "ops.outbox") {
        expect(all).toContain(`alter table ${table} force row level security`);
        continue;
      }
      expect(statement).toMatch(/company_id uuid/u);
      // Audit tables are append-only infrastructure without business-row bookkeeping.
      if (table.startsWith("audit.")) {
        expect(statements[position + 1]).toBe(
          `select ops.register_append_only_table('${table}');`,
        );
        continue;
      }
      expect(statement).toContain("unique (company_id, id)");
      const appendOnly = all.includes(
        `select ops.register_append_only_table('${table}')`,
      );
      for (const column of appendOnly
        ? []
        : ["version", "created_at", "created_by", "updated_at", "updated_by"])
        expect(statement).toMatch(new RegExp(`\\b${column} `, "u"));
      if (["lease.contract_template", "lease.clause"].includes(table)) {
        expect(all).toContain(`alter table ${table} force row level security`);
        expect(all).toContain(`on ${table} for select`);
        expect(all).toContain(`on ${table} for insert`);
        expect(all).toContain(`on ${table} for update`);
      } else {
        expectTableRegistration(statements, position, table);
      }
    }
    expect(file.sql).not.toMatch(/create\s+type\s+\S+\s+as\s+enum/iu);
  }
});

it.each([
  "",
  "create index example_id_idx on lease.example(id);",
  "create unique index example_id_idx on lease.example(id);",
  `create index example_id_idx on lease.example(id);
--> statement-breakpoint
create unique index example_unique_idx on lease.example using btree(id) where id is not null;`,
])("accepts registration after same-table indexes: %s", (indexes) => {
  const statements = splitStatements(`create table lease.example (id uuid);
--> statement-breakpoint
${indexes}
--> statement-breakpoint
select ops.register_business_table('lease.example');`);
  expect(() => {
    expectTableRegistration(statements, 0, "lease.example");
  }).not.toThrow();
});

it.each([
  "select 1;",
  "create index other_id_idx on lease.other(id);",
  "create index other_id_idx on lease.example_other(id);",
  "create index example_extra_idx on lease.example(id); select 1;",
])("refuses unrelated statements before registration: %s", (unrelated) => {
  const statements = splitStatements(`create table lease.example (id uuid);
--> statement-breakpoint
create index example_id_idx on lease.example(id);
--> statement-breakpoint
${unrelated}
--> statement-breakpoint
select ops.register_business_table('lease.example');`);
  expect(() => {
    expectTableRegistration(statements, 0, "lease.example");
  }).toThrow();
});

it("indexes every composite company reference", async () => {
  const migrations = await loadMigrations(directory);
  const all = migrations
    .map((file) => file.sql)
    .join("\n--> statement-breakpoint\n");
  // Inspect table definitions and later ALTER TABLE foreign keys alike.
  for (const statement of splitStatements(all)) {
    const table = /^(?:create|alter) table ([a-z_]+\.[a-z_]+)/u.exec(
      statement,
    )?.[1];
    if (!table) continue;
    for (const match of statement.matchAll(
      /foreign key \(([^)]+)\) references ([a-z_]+\.[a-z_]+)\s*\(([^)]+)\)/gu,
    )) {
      const source = match[1];
      const target = match[2];
      if (!source || !target) throw new Error("Invalid foreign key capture");
      const columns = source.replace(/\s/gu, "");
      if (target === "core.company") continue;
      expect(columns, `${table} -> ${target}`).toMatch(/^company_id,/u);
      const index = new RegExp(
        `(?:create (?:unique )?index \\w+ on ${table.replace(".", "\\.")}\\s*\\(|unique \\()${source
          .split(",")
          .map((column) => column.trim())
          .join(",\\s*")}(?:[,)]|\\s*\\))`,
        "u",
      );
      const tableSql = splitStatements(all)
        .filter(
          (candidate) =>
            candidate.startsWith(`create table ${table} (`) ||
            candidate.includes(` on ${table}(`) ||
            candidate.includes(` on ${table} (`),
        )
        .join("\n");
      expect(tableSql, `${table} (${columns})`).toMatch(index);
    }
  }
});

it("AC-2 preserves complete function bodies and nonempty statement boundaries", async () => {
  for (const file of await loadMigrations(directory)) {
    const raw = file.sql.split(/^--> statement-breakpoint\s*$/mu);
    expect(
      raw.every((statement) => statement.trim().length > 0),
      file.name,
    ).toBe(true);
    expect(splitStatements(file.sql)).toHaveLength(raw.length);
    for (const statement of splitStatements(file.sql)) {
      expect(statement.endsWith(";"), file.name).toBe(true);
      if (/^create (?:or replace )?function /u.test(statement)) {
        expect(statement.match(/\$\$/gu), file.name).toHaveLength(2);
        expect(statement, file.name).toMatch(/as \$\$[\s\S]+\$\$;$/u);
      }
    }
  }
});

it("creates the complete parties and estate catalogue with normalized search", async () => {
  const migrations = await loadMigrations(directory);
  const sql =
    migrations.find((file) => file.name.startsWith("0005"))?.sql ?? "";
  for (const table of [
    "party.owner",
    "party.tenant",
    "party.vendor",
    "estate.property",
    "estate.unit",
    "estate.ownership",
    "estate.owner_mandate",
    "estate.mandate_property",
  ])
    expect(sql).toContain(`create table ${table} (`);
  expect(sql).toContain("normalize(value, NFKC)");
  expect(sql.match(/using gin\(search_norm gin_trgm_ops\)/gu)).toHaveLength(5);
  expect(sql).toContain("add constraint technician_profile_vendor_fk");
  expect(sql).toContain("add constraint document_doc_type_check");
  expect(sql).toContain("share_bp > 0 and share_bp <= 10000");
  expect(sql).toContain("ends_on is null or ends_on >= starts_on");
});

it("creates contracts with immutable submissions and approval separation", async () => {
  const sql =
    (await loadMigrations(directory)).find((file) =>
      file.name.startsWith("0006"),
    )?.sql ?? "";
  for (const name of [
    "contract",
    "contract_version",
    "contract_version_clause",
    "contract_unit",
    "occupant",
    "contract_template",
    "clause",
    "approval",
    "tawtheeq_record",
    "discrepancy",
    "handover",
  ])
    expect(sql).toContain(`create table lease.${name} (`);
  expect(sql).toContain("errcode = 'AQ010'");
  expect(sql).toContain("if OLD.submitted_at is not null");
  expect(sql).toContain("order by id for update");
  expect(sql).toContain(
    "before insert or update on lease.contract_version_clause",
  );
  expect(sql).toContain("foreign key (company_id, id, current_version_id)");
  expect(sql).toContain(
    "daterange(occupancy_start, occupancy_end, '[]') with &&) where (blocks_unit)",
  );
  expect(sql).toContain(
    "num_nonnulls(contract_version_id, quote_id, tawtheeq_record_id, discrepancy_id) = 1",
  );
  expect(sql).toContain(
    "on lease.approval(company_id, subject_id, slot) where status in ('requested','approved')",
  );
  expect(sql).toContain(
    "on lease.approval(company_id, subject_id, approver_account_id) where status = 'approved'",
  );
  expect(sql).toContain("resolution <> 'mark_equivalent' or class = 'minor'");
  expect(sql).toContain(
    "company_id is null or company_id = ops.ctx_company_id()",
  );
});

it("restricts operations privileges and numbers within the transaction", async () => {
  const sql =
    (await loadMigrations(directory)).find((file) =>
      file.name.startsWith("0007"),
    )?.sql ?? "";
  for (const name of [
    "idempotency_key",
    "outbox",
    "number_series",
    "processed_event",
  ])
    expect(sql).toContain(`create table ops.${name} (`);
  expect(sql).toContain(
    "grant update (response) on ops.idempotency_key to aqarak_app",
  );
  expect(sql).toContain(
    "for delete to aqarak_scheduler using (created_at < now() - interval '7 days')",
  );
  expect(sql).toContain(
    "revoke all on ops.number_series from public, aqarak_app, aqarak_pipeline, aqarak_scheduler",
  );
  expect(sql).not.toMatch(/grant [^;]+on ops\.number_series/u);
  const number = splitStatements(sql).find((statement) =>
    statement.startsWith("create function ops.next_number"),
  );
  expect(number).toContain("security definer");
  expect(number).toContain("set search_path = pg_catalog, pg_temp");
  expect(number).toContain("ops.ctx_company_id()");
  expect(number).toContain("for update");
  expect(number).toContain("next_value = result + 1");
  expect(sql).toContain("greatest(6, length(n::text))");
  expect(sql).toContain("unique (bucket, s3_key, s3_version_id, scan_result)");
  const all = (await loadMigrations(directory))
    .map((file) => file.sql)
    .join("\n");
  const deleteGrants = all.match(/grant [^;]*\bdelete\b[^;]*;/giu);
  expect(deleteGrants).toEqual([
    "grant select, delete on ops.idempotency_key to aqarak_scheduler;",
  ]);
});

it("AC-3 creates money rows with VAT, reconciliation and conservation constraints", async () => {
  const sql =
    (await loadMigrations(directory)).find((file) =>
      file.name.startsWith("0008"),
    )?.sql ?? "";
  for (const name of [
    "instalment",
    "cheque",
    "charge",
    "payment",
    "allocation",
    "payment_reversal",
    "refund",
    "deposit",
    "invoice",
    "invoice_line",
    "credit_note",
    "receipt",
    "owner_statement",
    "owner_payout",
  ])
    expect(sql).toContain(`create table money.${name} (`);
  expect(sql).toContain(
    "check (vat_fils = (amount_fils * vat_bp + 5000) / 10000)",
  );
  expect(sql).toContain(
    "check (closing_fils = opening_fils + collections_fils - fees_fils - expenses_fils - payouts_fils)",
  );
  expect(sql).toContain(
    "check (deposited_on is null or deposited_on >= cheque_date)",
  );
  expect(sql).toContain("num_nonnulls(instalment_id, charge_id) = 1");
  expect(sql).toContain("errcode = 'AQ020'");
  expect(sql).toContain("order by p.id for update");
  expect(sql).toContain("order by id, kind");
  expect(sql).toContain("allocated + refunded > payment_row.amount_fils");
  expect(sql).toContain("allocated > capacity");
  expect(sql).toContain("a.status = 'active' and p.status = 'recorded'");
  for (const table of [
    "allocation",
    "refund",
    "payment",
    "instalment",
    "charge",
  ])
    expect(sql).toContain(
      `conservation after insert or update on money.${table}`,
    );
  expect(sql).not.toContain("update money.instalment set status");
  expect(sql).toContain("check (vat_fils = 0 or issuer_trn is not null)");
  expect(sql).toContain("check (status = 'draft' or number is not null)");
  const cheque = splitStatements(sql).find((statement) =>
    statement.startsWith("create table money.cheque"),
  );
  expect(cheque).not.toMatch(/\b(?:iban|account_number|account_no)\b/u);
});

it("creates work, maintenance and bounded append-only model records", async () => {
  const sql =
    (await loadMigrations(directory)).find((file) =>
      file.name.startsWith("0009"),
    )?.sql ?? "";
  for (const table of [
    "work.note",
    "work.task",
    "work.reminder",
    "work.notification",
    "maint.ticket",
    "maint.quote",
    "maint.dispatch",
    "ai.model_call",
    "ai.extraction",
    "ai.drafted_action",
  ])
    expect(sql).toContain(`create table ${table} (`);
  expect(sql).toContain("char_length(body) <= 8000");
  expect(sql).toContain("rule_code ~ '^N([1-9]|1[0-3])$'");
  expect(sql.match(/tsvector generated always/gu)).toHaveLength(2);
  expect(sql.match(/using gin\(search_vector\)/gu)).toHaveLength(2);
  expect(sql).toContain("to_tsvector('arabic'::regconfig");
  expect(sql).toContain("to_tsvector('english'::regconfig");
  expect(sql).toContain("num_nonnulls(technician_profile_id, vendor_id) = 1");
  expect(sql).toContain("visit_to > visit_from");
  expect(sql).toContain(
    "add constraint approval_quote_fk foreign key (company_id, quote_id)",
  );
  expect(sql).toContain(
    "add constraint charge_ticket_fk foreign key (company_id, ticket_id)",
  );
  for (const name of ["model_call", "extraction"]) {
    expect(sql).toContain(
      `select ops.register_append_only_table('ai.${name}')`,
    );
    expect(sql).toContain(`capture_version after insert on ai.${name}`);
    expect(sql).toContain(
      `revoke insert on ai.${name} from aqarak_app, aqarak_scheduler`,
    );
  }
  expect(sql).toContain("char_length((field.value->'value')::text) <= 2000");
  expect(sql).toContain("char_length(field.value->>'evidence') <= 2000");
  expect(sql).toContain("check (ai.valid_extraction_fields(fields))");
  const model = splitStatements(sql).find((statement) =>
    statement.startsWith("create table ai.model_call"),
  );
  expect(model).not.toMatch(
    /\b(?:body|content|prompt|input|output) (?:text|jsonb)/u,
  );
  expect(sql).toContain(
    "grant insert, update on ai.drafted_action to aqarak_pipeline",
  );
  expect(sql).toContain(
    "grant insert, update on work.notification to aqarak_scheduler",
  );
});
