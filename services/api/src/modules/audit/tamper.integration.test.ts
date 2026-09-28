import { randomUUID } from "node:crypto";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { withCompanyTx } from "@aqarak/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFixture } from "./integration-fixture";
import type { AnchorView, VerificationView } from "./chain";

function masterDatabase(): DataApiExecutor {
  const env = z
    .strictObject({
      resourceArn: z.string().min(1),
      secretArn: z.string().min(1),
      database: z.string().min(1),
      region: z.string().min(1),
    })
    .parse({
      resourceArn: process.env.DATABASE_CLUSTER_ARN,
      secretArn: process.env.MASTER_SECRET_ARN,
      database: process.env.DATABASE_NAME,
      region: process.env.AWS_REGION,
    });
  return createDataApiExecutor({
    resourceArn: env.resourceArn,
    secretArn: env.secretArn,
    database: env.database,
    client: new RDSDataClient({ region: env.region }),
  });
}

// Master access is required only to tamper with isolated synthetic chains behind append-only protections.
describe.skipIf(
  process.env.AQARAK_INTEGRATION !== "1" || !process.env.MASTER_SECRET_ARN,
)("audit tamper integration", { timeout: 120_000 }, () => {
  it.each(["edit", "gap", "suffix"] as const)(
    "AC-9 detects %s tampering against a locked checkpoint",
    async (kind) => {
      const fixture = await createFixture();
      try {
        const anchorResponse = await fixture.request("/anchors", {
          method: "POST",
          body: {},
          key: randomUUID(),
        });
        expect(anchorResponse.status).toBe(201);
        const anchor = (await anchorResponse.json()) as AnchorView;
        expect(anchor.seq).toBeGreaterThanOrEqual(5);
        await withCompanyTx(
          masterDatabase(),
          { companyId: fixture.companyId, accountId: fixture.accounts.manager },
          async (tx) => {
            await tx.execute("set local session_replication_role = replica");
            const params = [
              { name: "company", value: fixture.companyId },
              { name: "seq", value: kind === "suffix" ? anchor.seq : 3 },
            ];
            if (kind === "edit") {
              await tx.execute(
                "update audit.audit_event set reason = 'Synthetic tamper' where company_id = :company::uuid and seq = :seq::bigint",
                params,
              );
            } else if (kind === "gap") {
              await tx.execute(
                "delete from audit.audit_event where company_id = :company::uuid and seq = :seq::bigint",
                params,
              );
            } else {
              // Remove the anchored tip and the subsequent chain.anchored marker, then forge the matching head.
              await tx.execute(
                "delete from audit.audit_event where company_id = :company::uuid and seq >= :seq::bigint",
                params,
              );
              await tx.execute(
                "update audit.chain_head h set seq = e.seq, head_hash = e.row_hash from audit.audit_event e where h.company_id = :company::uuid and e.company_id = h.company_id and e.seq = :seq::bigint - 1",
                params,
              );
            }
          },
        );
        const response = await fixture.request("/verification", {
          method: "POST",
          body: {},
          key: randomUUID(),
        });
        expect(response.status).toBe(200);
        const result = (await response.json()) as VerificationView;
        expect(result.ok).toBe(false);
        expect(result.anchorProblem).toBeNull();
        if (kind === "edit") {
          expect(result.recomputed.break).toEqual({
            kind: "row_hash_mismatch",
            seq: 3,
          });
          expect(result.sql.firstBadSeq).toBe(3);
        } else if (kind === "gap") {
          expect(["seq_gap", "prev_hash_mismatch"]).toContain(
            result.recomputed.break?.kind,
          );
          expect(result.recomputed.break?.seq).toBe(3);
          expect(result.sql.firstBadSeq).toBe(3);
        } else {
          expect(result.sql.ok).toBe(true);
          expect(result.recomputed.break).toEqual({
            kind: "behind_anchor",
            seq: anchor.seq,
          });
          expect(result.anchor?.seq).toBe(anchor.seq);
        }
      } finally {
        await fixture.close();
      }
    },
  );
});
