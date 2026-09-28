import { createHash, randomUUID } from "node:crypto";
import {
  withCompanyTx,
  type CompanyTransaction,
  type Parameter,
  type Row,
} from "@aqarak/db";
import {
  idempotencyKey,
  requestSha256,
  type Capability,
  type PermissionOperation,
  type Role,
} from "@aqarak/domain";
import { z } from "zod";
import type { Dependencies, Client } from "./ports";
import type { Principal } from "./guard";
import { Refusal } from "./problems";
export const nilCompany = "00000000-0000-0000-0000-000000000000";
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function params(
  values: Record<string, string | number | boolean | null>,
): Parameter[] {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}
export function databaseInstant(value: unknown): Date {
  const text = z.string().parse(value);
  const result = new Date(
    /[zZ]|[+-]\d{2}(?::?\d{2})?$/.test(text)
      ? text
      : `${text.replace(" ", "T")}Z`,
  );
  if (!Number.isFinite(result.getTime()))
    throw new Error("Invalid database timestamp");
  return result;
}
export function json(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}
export async function rows(
  tx: CompanyTransaction,
  sql: string,
  values: Record<string, string | number | boolean | null> = {},
): Promise<Row[]> {
  return (await tx.execute(sql, params(values))).rows;
}
export async function one(
  tx: CompanyTransaction,
  sql: string,
  values: Record<string, string | number | boolean | null> = {},
): Promise<Row> {
  const row = (await rows(tx, sql, values))[0];
  if (!row) throw new Refusal("NOT_FOUND");
  return row;
}
export function accountTx<T>(
  deps: Dependencies,
  accountId: string | null,
  fn: (tx: CompanyTransaction) => Promise<T>,
): Promise<T> {
  return withCompanyTx(deps.executor, { companyId: nilCompany, accountId }, fn);
}
export interface SecurityInput {
  accountId?: string | null;
  type:
    | "sign_up"
    | "sign_up_confirmed"
    | "sign_in"
    | "sign_in_refused"
    | "token_refreshed"
    | "sign_out"
    | "session_expired"
    | "token_revoke_failed"
    | "company_create_refused"
    | "access_refused";
  client?: Client;
  sessionId?: string | null;
  email?: string;
}
export async function securityEvent(
  tx: CompanyTransaction,
  input: SecurityInput,
): Promise<void> {
  await rows(
    tx,
    "insert into ops.security_event(account_id,event_type,client,session_id,email_sha256) values(cast(:account as uuid),:type,:client,cast(:session as uuid),:email)",
    {
      account: input.accountId ?? null,
      type: input.type,
      client: input.client ?? null,
      session: input.sessionId ?? null,
      email: input.email ? sha256(input.email.trim().toLowerCase()) : null,
    },
  );
}
export function recordSecurity(
  deps: Dependencies,
  input: SecurityInput,
): Promise<void> {
  return accountTx(deps, input.accountId ?? null, (tx) =>
    securityEvent(tx, input),
  );
}
export interface SubjectVersion {
  type: string;
  id: string;
  version: number;
}
export interface AuditInput {
  companyId: string;
  principal: Pick<Principal, "accountId" | "client">;
  eventType: string;
  primary: { type: string; id: string; before?: number; after?: number };
  role?: Role | null;
  changedFields?: string[];
  reason?: string;
  key?: string;
  permission?: { capability: Capability; operation: PermissionOperation };
  denialReasons?: string[];
  covered?: SubjectVersion[];
}
export async function auditEvent(
  tx: CompanyTransaction,
  input: AuditInput,
): Promise<void> {
  const eventId = randomUUID();
  const decision = input.denialReasons
    ? {
        policy_version: "permissions-2026-09-28",
        result: "deny",
        reasons: input.denialReasons,
      }
    : input.permission
      ? {
          policy_version: "permissions-2026-09-28",
          result: "allow",
          reasons: [
            `capability:${input.permission.capability}`,
            `operation:${input.permission.operation}`,
          ],
        }
      : null;
  await rows(
    tx,
    `insert into audit.audit_event(event_id,company_id,event_type,actor_account_id,actor_role,initiator,channel,subject_type,subject_id,version_before,version_after,changed_fields,reason,idempotency_key,policy_decision)
    values(cast(:event as uuid),cast(:company as uuid),:type,cast(:account as uuid),:role,'person',:channel,:subjectType,cast(:subject as uuid),:before,:after,cast(:fields as jsonb),:reason,:key,cast(:decision as jsonb))`,
    {
      event: eventId,
      company: input.companyId,
      type: input.eventType,
      account: input.principal.accountId,
      role: input.role ?? null,
      channel: input.principal.client === "web" ? "web_form" : "mobile_form",
      subjectType: input.primary.type,
      subject: input.primary.id,
      before: input.primary.before ?? null,
      after: input.primary.after ?? null,
      fields: JSON.stringify(input.changedFields ?? []),
      reason: input.reason ?? null,
      key: input.key ?? null,
      decision: decision ? JSON.stringify(decision) : null,
    },
  );
  if (input.covered?.length)
    await rows(
      tx,
      `insert into audit.event_subject(company_id,event_id,subject_type,subject_id,subject_version)
    select cast(:company as uuid),cast(:event as uuid),x.type,x.id,x.version from jsonb_to_recordset(cast(:subjects as jsonb)) as x(type text,id uuid,version integer)`,
      {
        company: input.companyId,
        event: eventId,
        subjects: JSON.stringify(input.covered),
      },
    );
}
export interface CommandResponse {
  status: number;
  body: unknown;
  replayed?: boolean;
}
const responseSchema = z.object({
  status: z.number().int(),
  body: z.unknown(),
});
export interface IdempotencyInput {
  companyId: string;
  accountId: string;
  command: string;
  key: string | undefined;
  path: Record<string, string>;
  body: unknown;
}
export function parseKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = idempotencyKey.safeParse(value);
  if (!parsed.success) throw new Refusal("VALIDATION_FAILED");
  return parsed.data;
}
export async function withIdempotency(
  tx: CompanyTransaction,
  input: IdempotencyInput,
  run: () => Promise<CommandResponse>,
  replayBody: (body: unknown) => unknown = (body) => body,
): Promise<CommandResponse> {
  const key = parseKey(input.key);
  if (key === undefined) return run();
  const values = {
    company: input.companyId,
    account: input.accountId,
    command: input.command,
    key,
    hash: requestSha256({
      pathParams: input.path,
      body: z.json().parse(JSON.parse(JSON.stringify(input.body))),
    }),
  };
  const reserved = await rows(
    tx,
    `insert into ops.idempotency_key(company_id,account_id,command_type,key,request_sha256) values(cast(:company as uuid),cast(:account as uuid),:command,:key,:hash) on conflict do nothing returning key`,
    values,
  );
  if (!reserved.length) {
    const stored = await one(
      tx,
      "select request_sha256,response from ops.idempotency_key where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and command_type=:command and key=:key",
      values,
    );
    if (stored.request_sha256 !== values.hash)
      throw new Refusal("IDEMPOTENCY_KEY_REUSED");
    return { ...responseSchema.parse(json(stored.response)), replayed: true };
  }
  const result = await run();
  await rows(
    tx,
    "update ops.idempotency_key set response=cast(:response as jsonb) where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and command_type=:command and key=:key",
    {
      ...values,
      response: JSON.stringify({
        status: result.status,
        body: replayBody(result.body),
      }),
    },
  );
  return result;
}
export function companyCreationId(
  accountId: string,
  key: string | undefined,
): string {
  if (!key) return randomUUID();
  const namespace = Buffer.from("be4edc6cb73f57e99edc583b35d04fb2", "hex");
  const hash = createHash("sha1")
    .update(namespace)
    .update(`${accountId}:${key}`)
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function isUnique(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(constraint) &&
    /23505|duplicate key/.test(error.message)
  );
}
