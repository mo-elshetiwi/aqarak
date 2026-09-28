import { randomUUID } from "node:crypto";
import {
  CommitTransactionCommand,
  type RDSDataClient,
} from "@aws-sdk/client-rds-data";
import { CONTEXT_SQL, withSystemTx } from "../company-tx.ts";
import type { DataApiExecutor } from "../data-api.ts";
import { assertGate, createCompany, insertCompany, uuid } from "./fixtures.ts";

export async function checkIsolation(
  executor: DataApiExecutor,
  companies: { a: string; b: string },
): Promise<Record<string, unknown>> {
  await createCompany(executor, companies.a);
  // These two deliberately unscoped reads are the isolation probe, never application access.
  const id = await executor.begin();
  try {
    const result = await executor.execute(
      "select count(*)::text as count from core.company",
      [],
      id,
    );
    assertGate(
      result.rows[0]?.count === "0",
      "Context leaked into a new transaction",
    );
    await executor.commit(id);
  } catch (error) {
    await executor.rollback(id).catch(() => undefined);
    throw error;
  }
  const outside = await executor.execute(
    "select count(*)::text as count from core.company",
  );
  assertGate(
    outside.rows[0]?.count === "0",
    "Context leaked outside a transaction",
  );
  await withSystemTx(executor, { companyId: companies.b }, async (tx) => {
    const result = await tx.execute(
      "select count(*)::text as count from core.company where id = :a",
      [uuid("a", companies.a)],
    );
    assertGate(result.rows[0]?.count === "0", "Company B can read company A");
  });
  await withSystemTx(executor, { companyId: companies.a }, async (tx) => {
    const result = await tx.execute(
      "select current_setting('app.company_id', true) as context, count(*)::text as count from core.company where id = :a",
      [uuid("a", companies.a)],
    );
    assertGate(
      result.rows[0]?.context === companies.a && result.rows[0].count === "1",
      "Transaction did not retain its local company context",
    );
  });
  await createCompany(executor, companies.b);
  return {
    withoutContext: 0,
    outsideTransaction: 0,
    otherCompany: 0,
    sameTransaction: 1,
  };
}
export interface RawCommitOptions {
  client: RDSDataClient;
  resourceArn: string;
  secretArn: string;
}
export async function checkAuditRollback(
  executor: DataApiExecutor,
  options: RawCommitOptions,
): Promise<Record<string, unknown>> {
  const companyId = randomUUID();
  const id = await executor.begin();
  let rawMessage = "";
  try {
    await executor.execute(
      CONTEXT_SQL,
      [
        { name: "company_id", value: companyId },
        { name: "account_id", value: "" },
      ],
      id,
    );
    await insertCompany(
      { execute: (sql, params) => executor.execute(sql, params, id) },
      companyId,
    );
    try {
      await options.client.send(
        new CommitTransactionCommand({
          resourceArn: options.resourceArn,
          secretArn: options.secretArn,
          transactionId: id,
        }),
      );
    } catch (error) {
      rawMessage = error instanceof Error ? error.message : "";
    }
  } finally {
    await executor.rollback(id).catch(() => undefined);
  }
  assertGate(
    rawMessage.includes(
      "Entity version requires exactly one covering audit event in the same transaction",
    ),
    `Raw CommitTransaction error omitted the AQ002 trigger message: ${rawMessage || "no error returned"}`,
  );
  await withSystemTx(executor, { companyId }, async (tx) => {
    const result = await tx.execute(
      "select count(*)::text as count from core.company where id = :id",
      [uuid("id", companyId)],
    );
    assertGate(
      result.rows[0]?.count === "0",
      "Unaudited company survived the failed commit",
    );
  });
  return { companyId, rawCommitMessage: rawMessage, rolledBack: true };
}
export const CANONICAL_CASES: readonly (readonly [string, string])[] = [
  ['{"b":1,"a":"x"}', '{"a":"x","b":"1"}'],
  ['{"amount":1.50}', '{"amount":"1.5"}'],
  ['{"n":null,"arr":[2,{"z":true}]}', '{"arr":["2",{"z":true}],"n":null}'],
  ['{"name":"عقارك"}', '{"name":"عقارك"}'],
  [JSON.stringify("a\tb\u0001"), '"a\\tb\\u0001"'],
  [JSON.stringify('q"b\\'), '"q\\"b\\\\"'],
];
export async function checkAuditChain(
  executor: DataApiExecutor,
  companyIds: readonly string[],
): Promise<Record<string, unknown>> {
  for (const companyId of companyIds) {
    await withSystemTx(executor, { companyId }, async (tx) => {
      const chain = await tx.execute(
        "select * from audit.verify_chain(:company)",
        [uuid("company", companyId)],
      );
      assertGate(chain.rows[0]?.ok === true, "Audit chain verification failed");
      for (const [input, expected] of CANONICAL_CASES) {
        const result = await tx.execute(
          "select audit.canonical_text(cast(:value as jsonb)) as canonical",
          [{ name: "value", value: input, typeHint: "JSON" }],
        );
        assertGate(
          result.rows[0]?.canonical === expected,
          "AQ-CANON-1 vector mismatch",
        );
      }
    });
  }
  return {
    companyIds: [...companyIds],
    canonicalCases: CANONICAL_CASES.length,
    verified: true,
  };
}
