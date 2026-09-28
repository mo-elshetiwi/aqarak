import type { DataApiExecutor, Row } from "../data-api.ts";

export const RUNTIME_ROLES = [
  "aqarak_app",
  "aqarak_pipeline",
  "aqarak_scheduler",
] as const;
export const APPLICATION_SCHEMAS = [
  "core",
  "party",
  "estate",
  "lease",
  "money",
  "maint",
  "doc",
  "work",
  "ai",
  "audit",
  "ops",
] as const;
const schemaList = APPLICATION_SCHEMAS.map((name) => `'${name}'`).join(", ");
const roleList = RUNTIME_ROLES.map((name) => `'${name}'`).join(", ");

export interface CataloguePolicy {
  name: string;
  command: string;
  roles: string[];
  using: string | null;
  withCheck: string | null;
  permissive: boolean;
  appliesToScheduler: boolean;
}
export interface CatalogueTrigger {
  name: string;
  function: string;
  enabled: string;
  definition: string;
}
export interface CatalogueTable {
  name: string;
  schema: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  hasCompanyId: boolean;
  policies: CataloguePolicy[];
  triggers: CatalogueTrigger[];
  privileges: Record<string, Record<string, boolean>>;
}
export interface CatalogueRole {
  name: string;
  rolsuper: boolean | null;
  rolbypassrls: boolean | null;
}
export interface CatalogueAssertion {
  name: string;
  passed: boolean;
  violations: string[];
}

export const TABLES_SQL = `select jsonb_build_object(
  'name', n.nspname || '.' || c.relname, 'schema', n.nspname,
  'relrowsecurity', c.relrowsecurity, 'relforcerowsecurity', c.relforcerowsecurity,
  'hasCompanyId', exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0 and not a.attisdropped),
  'policies', coalesce((select jsonb_agg(jsonb_build_object(
    'name', p.polname,
    'command', case p.polcmd when '*' then 'ALL' when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' end,
    'roles', (select jsonb_agg(case when r = 0 then 'public' else pg_get_userbyid(r) end order by r) from unnest(p.polroles) r),
    'using', pg_get_expr(p.polqual, p.polrelid), 'withCheck', pg_get_expr(p.polwithcheck, p.polrelid),
    'permissive', p.polpermissive,
    'appliesToScheduler', exists (select 1 from unnest(p.polroles) r where case when r = 0 then true else pg_has_role('aqarak_scheduler', r, 'USAGE') end)
  ) order by p.polname) from pg_policy p where p.polrelid = c.oid), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(jsonb_build_object(
    'name', t.tgname, 'function', pn.nspname || '.' || pr.proname,
    'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)
  ) order by t.tgname) from pg_trigger t join pg_proc pr on pr.oid = t.tgfoid join pg_namespace pn on pn.oid = pr.pronamespace where t.tgrelid = c.oid and not t.tgisinternal), '[]'::jsonb),
  'privileges', (select jsonb_object_agg(r.rolname, jsonb_build_object(
    'SELECT', has_table_privilege(r.oid, c.oid, 'SELECT'),
    'INSERT', has_table_privilege(r.oid, c.oid, 'INSERT'),
    'UPDATE', has_table_privilege(r.oid, c.oid, 'UPDATE'),
    'DELETE', has_table_privilege(r.oid, c.oid, 'DELETE'),
    'TRUNCATE', has_table_privilege(r.oid, c.oid, 'TRUNCATE'),
    'REFERENCES', has_table_privilege(r.oid, c.oid, 'REFERENCES')
  )) from pg_roles r where r.rolname in (${roleList}))
) as entry from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'f') and n.nspname in (${schemaList}) order by n.nspname, c.relname`;

export const ROLES_SQL = `select rolname as name, rolsuper, rolbypassrls from pg_roles where rolname in (${roleList}) order by rolname`;
// I inspect effective privileges across all database tables, including other schemas.
export const FORBIDDEN_PRIVILEGES_SQL = `select n.nspname || '.' || c.relname as name, r.rolname as role, p.privilege
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r cross join (values ('TRUNCATE'), ('REFERENCES'), ('DELETE')) p(privilege)
where c.relkind in ('r', 'p', 'f') and r.rolname in (${roleList})
and has_table_privilege(r.oid, c.oid, p.privilege)
and not (n.nspname = 'ops' and c.relname = 'idempotency_key' and r.rolname = 'aqarak_scheduler' and p.privilege = 'DELETE')
order by n.nspname, c.relname, r.rolname, p.privilege`;

function canonicalPredicate(value: string | null): string {
  return (value ?? "").replace(/[\s()]/gu, "");
}
export function validateCatalogue(
  tables: readonly CatalogueTable[],
  roles: readonly CatalogueRole[],
  forbiddenPrivileges: readonly Row[],
): CatalogueAssertion[] {
  const assertions: CatalogueAssertion[] = [];
  const add = (name: string, violations: string[]): void => {
    assertions.push({ name, passed: violations.length === 0, violations });
  };
  add(
    "all application schemas represented",
    APPLICATION_SCHEMAS.filter(
      (schema) => !tables.some((table) => table.schema === schema),
    ),
  );
  add(
    "company tables enable and force row security",
    tables
      .filter(
        (table) =>
          table.hasCompanyId &&
          (!table.relrowsecurity || !table.relforcerowsecurity),
      )
      .map((table) => table.name),
  );
  add(
    "runtime roles are present without superuser or bypass row security",
    RUNTIME_ROLES.filter(
      (name) =>
        !roles.some(
          (role) =>
            role.name === name &&
            role.rolsuper === false &&
            role.rolbypassrls === false,
        ),
    ),
  );
  add(
    "no forbidden effective table privileges anywhere",
    forbiddenPrivileges.map(
      (row) =>
        `${String(row.role)} ${String(row.privilege)} ${String(row.name)}`,
    ),
  );
  add(
    "scheduler DELETE is restricted to the seven-day housekeeping policy",
    housekeepingViolations(tables),
  );
  return assertions;
}
function isHousekeepingPolicy(policy: CataloguePolicy | undefined): boolean {
  return (
    policy?.name === "idempotency_housekeeping_delete" &&
    policy.command === "DELETE" &&
    policy.permissive &&
    policy.roles.length === 1 &&
    policy.roles[0] === "aqarak_scheduler" &&
    canonicalPredicate(policy.using) ===
      canonicalPredicate("created_at < now() - '7 days'::interval")
  );
}
function housekeepingViolations(tables: readonly CatalogueTable[]): string[] {
  const housekeeping = tables.find(
    (table) => table.name === "ops.idempotency_key",
  );
  const deletePolicies =
    housekeeping?.policies.filter(
      (policy) =>
        policy.appliesToScheduler && ["ALL", "DELETE"].includes(policy.command),
    ) ?? [];
  const policy = deletePolicies[0];
  return [
    ...(housekeeping?.relrowsecurity === true &&
    housekeeping.relforcerowsecurity
      ? []
      : ["Housekeeping row security is not forced"]),
    ...(housekeeping?.privileges.aqarak_scheduler?.DELETE === true
      ? []
      : ["Scheduler DELETE grant is missing"]),
    ...(deletePolicies.length === 1 && isHousekeepingPolicy(policy)
      ? []
      : ["Housekeeping DELETE policy differs from migration 0007"]),
  ];
}

export interface CatalogueSnapshot {
  metadata: Row | undefined;
  tableCount: number;
  companyTableCount: number;
  tables: (CatalogueTable & {
    versionTriggers: CatalogueTrigger[];
    entityVersionTriggers: CatalogueTrigger[];
  })[];
  roles: CatalogueRole[];
  forbiddenPrivileges: Row[];
  assertions: CatalogueAssertion[];
  passed: boolean;
}
export async function inspectCatalogue(
  executor: DataApiExecutor,
): Promise<CatalogueSnapshot> {
  const transaction = await executor.begin();
  try {
    await executor.execute(
      "set transaction isolation level repeatable read read only",
      [],
      transaction,
    );
    const read = async (sql: string): Promise<Row[]> =>
      (await executor.execute(sql, [], transaction)).rows;
    const metadata = await read(
      "select version() as engine_version, current_user as database_user, current_setting('transaction_read_only') as read_only, current_setting('transaction_isolation') as isolation",
    );
    const tables = (await read(TABLES_SQL)).map(
      ({ entry }) =>
        (typeof entry === "string"
          ? JSON.parse(entry)
          : entry) as CatalogueTable,
    );
    const roles = (await read(ROLES_SQL)) as unknown as CatalogueRole[];
    const forbiddenPrivileges = await read(FORBIDDEN_PRIVILEGES_SQL);
    const assertions = validateCatalogue(tables, roles, forbiddenPrivileges);
    return {
      metadata: metadata[0],
      tableCount: tables.length,
      companyTableCount: tables.filter((table) => table.hasCompanyId).length,
      tables: tables.map((table) => ({
        ...table,
        versionTriggers: table.triggers.filter(
          (trigger) => trigger.function === "ops.stamp_update",
        ),
        entityVersionTriggers: table.triggers.filter(
          (trigger) => trigger.function === "audit.capture_entity_version",
        ),
      })),
      roles,
      forbiddenPrivileges,
      assertions,
      passed: assertions.every((assertion) => assertion.passed),
    };
  } finally {
    await executor.rollback(transaction);
  }
}
