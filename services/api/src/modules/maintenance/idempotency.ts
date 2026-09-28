import { z } from "zod";
import { parameter, uuid, type Transaction } from "./access";
import { Problem } from "./problem";

export interface CommandResponse {
  status: number;
  body: unknown;
  replayed?: boolean;
}
export interface CommandKey {
  key: string;
  command: string;
  hash: string;
}
export function idempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(key))
    throw new Problem(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
    );
  return key;
}
function parameters(
  tx: Transaction,
  key: CommandKey,
): ReturnType<typeof parameter>[] {
  return [
    uuid("company", tx.scope.companyId),
    uuid("account", tx.accountId),
    parameter("command", key.command),
    parameter("key", key.key),
    parameter("hash", key.hash),
  ];
}
const responseSchema = z.object({
  status: z.number().int(),
  body: z.unknown(),
});
export async function replay(
  tx: Transaction,
  key: CommandKey,
): Promise<CommandResponse | null> {
  const row = (
    await tx.execute(
      "select request_sha256, response from ops.idempotency_key where company_id = :company and account_id = :account and command_type = :command and key = :key",
      parameters(tx, key),
    )
  ).rows[0];
  if (!row) return null;
  if (row.request_sha256 !== key.hash)
    throw new Problem(
      422,
      "IDEMPOTENCY_KEY_REUSED",
      "This key was used for a different request.",
    );
  const stored = responseSchema.parse(
    typeof row.response === "string"
      ? (JSON.parse(row.response) as unknown)
      : row.response,
  );
  return { status: stored.status, body: stored.body, replayed: true };
}
export async function claim(
  tx: Transaction,
  key: CommandKey,
): Promise<CommandResponse | null> {
  const inserted = await tx.execute(
    `insert into ops.idempotency_key(company_id, account_id, command_type, key, request_sha256)
    values (:company, :account, :command, :key, :hash) on conflict do nothing returning key`,
    parameters(tx, key),
  );
  return inserted.rows.length ? null : replay(tx, key);
}
export async function storeResponse(
  tx: Transaction,
  key: CommandKey,
  response: CommandResponse,
): Promise<void> {
  await tx.execute(
    "update ops.idempotency_key set response = :response where company_id = :company and account_id = :account and command_type = :command and key = :key",
    [
      ...parameters(tx, key),
      parameter(
        "response",
        JSON.stringify({ status: response.status, body: response.body }),
        "JSON",
      ),
    ],
  );
}
