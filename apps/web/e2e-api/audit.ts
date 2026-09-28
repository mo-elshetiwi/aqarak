import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
const execute = promisify(execFile);
/** I read the scoped audit chain without retaining account or session credentials. */
export async function denialCount(
  companyId: string,
  accountId: string,
): Promise<number> {
  const resource = process.env.DATABASE_CLUSTER_ARN;
  const secret = process.env.APP_SECRET_ARN;
  if (!resource || !secret || process.env.DATABASE_NAME !== "aqarak_identity")
    throw new Error("Identity database configuration is required");
  const common = [
    "--resource-arn",
    resource,
    "--secret-arn",
    secret,
    "--database",
    "aqarak_identity",
  ];
  async function run(args: string[]): Promise<unknown> {
    try {
      const result = await execute(
        "aws",
        ["rds-data", ...args, "--output", "json", "--no-cli-pager"],
        { maxBuffer: 1024 * 1024 },
      );
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error("Scoped audit read failed");
    }
  }
  const transaction = z
    .object({ transactionId: z.string() })
    .parse(await run(["begin-transaction", ...common])).transactionId;
  const scope = [...common, "--transaction-id", transaction];
  try {
    await run([
      "execute-statement",
      ...scope,
      "--sql",
      "select set_config('app.company_id', :company, true), set_config('app.account_id', :account, true)",
      "--parameters",
      JSON.stringify([
        { name: "company", value: { stringValue: companyId } },
        { name: "account", value: { stringValue: accountId } },
      ]),
    ]);
    const result = z
      .object({
        records: z.array(z.array(z.object({ longValue: z.number() }))),
      })
      .parse(
        await run([
          "execute-statement",
          ...scope,
          "--sql",
          "select count(*) from audit.audit_event where event_type='policy.denied'",
        ]),
      );
    const count = result.records[0]?.[0]?.longValue;
    if (count === undefined) throw new Error("Audit count unavailable");
    return count;
  } finally {
    await run([
      "rollback-transaction",
      "--resource-arn",
      resource,
      "--secret-arn",
      secret,
      "--transaction-id",
      transaction,
    ]);
  }
}
