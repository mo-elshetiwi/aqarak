import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import type { DataApiExecutor } from "./data-api.ts";

export const RUNTIME_ROLES = [
  "aqarak_app",
  "aqarak_pipeline",
  "aqarak_scheduler",
] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];
export interface RoleSecret {
  role: string;
  secretArn: string;
}
export type ReadSecret = (arn: string) => Promise<string>;
export function scramSha256Verifier(
  password: string,
  salt: Uint8Array = randomBytes(16),
): string {
  if (salt.byteLength !== 16)
    throw new Error("SCRAM salt must contain 16 bytes");
  // Runtime credentials are generated ASCII passwords. Reject unsupported SASLprep inputs.
  if (!/^[\x20-\x7e]+$/u.test(password))
    throw new Error("Runtime password must contain printable ASCII characters");
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", salted)
    .update("Server Key")
    .digest("base64");
  return `SCRAM-SHA-256$4096:${Buffer.from(salt).toString("base64")}$${storedKey}:${serverKey}`;
}
function parseSecret(value: string, role: string): string {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("username" in parsed) ||
    !("password" in parsed) ||
    parsed.username !== role ||
    typeof parsed.password !== "string"
  )
    throw new Error("Invalid runtime role secret");
  return parsed.password;
}
export async function bootstrapRoles(
  executor: DataApiExecutor,
  roleSecrets: readonly RoleSecret[],
  readSecret: ReadSecret,
): Promise<{ roles: string[] }> {
  if (
    roleSecrets.some(
      ({ role }) => !RUNTIME_ROLES.some((allowed) => allowed === role),
    ) ||
    new Set(roleSecrets.map(({ role }) => role)).size !== roleSecrets.length
  )
    throw new Error("Invalid runtime role allow-list");
  const roles: string[] = [];
  for (const { role, secretArn } of roleSecrets) {
    // Secret values and verifier-bearing SQL never enter logs or returned summaries.
    const verifier = scramSha256Verifier(
      parseSecret(await readSecret(secretArn), role),
    );
    const id = await executor.begin();
    try {
      const existing = await executor.execute(
        "select 1 as present, rolsuper, rolbypassrls from pg_roles where rolname = :role",
        [{ name: "role", value: role }],
        id,
      );
      const roleAttributes = existing.rows[0];
      if (
        roleAttributes &&
        (roleAttributes.rolsuper !== false ||
          roleAttributes.rolbypassrls !== false)
      )
        throw new Error(
          "Existing runtime role has unsafe privilege attributes",
        );
      // Aurora's master cannot ALTER the superuser or bypass attributes. I verify
      // existing roles and set safe attributes explicitly only when creating a role.
      await executor.execute(
        `${existing.rows.length ? "alter" : "create"} role ${role} ${existing.rows.length ? "with " : "nosuperuser nobypassrls "}login password '${verifier}'`,
        [],
        id,
      );
      await executor.execute(
        `alter role ${role} nocreatedb nocreaterole inherit`,
        [],
        id,
      );
      await executor.commit(id);
      roles.push(role);
    } catch {
      await executor.rollback(id).catch(() => undefined);
      // Database errors may echo password-bearing SQL, so deliberately discard the cause here.
      throw new Error(`Runtime role bootstrap failed: ${role}`);
    }
  }
  return { roles };
}
