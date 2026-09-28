import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DemoIds } from "./seed-demo";
import type { DraftInput } from "../schema";
export interface SmokeOptions {
  sessions: Readonly<Record<string, string>>;
  baseUrl?: string;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  print?: (line: string) => void;
  now?: () => Date;
}
export function demoDraft(ids: DemoIds, now: Date): DraftInput {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const date = (offset: number, day = 1) =>
    new Date(Date.UTC(year, month + offset, day)).toISOString().slice(0, 10);
  return {
    tenantId: ids.tenantId,
    unitId: ids.unitId,
    termStart: date(0),
    termEnd: date(12, 0),
    graceDays: 0,
    annualRentFils: 8_500_000,
    totalFils: 8_500_000,
    depositFils: 500_000,
    vatBp: 0,
    instalments: [0, 1, 2, 3].map((index) => ({
      seqNo: index + 1,
      dueOn: date(index * 3),
      amountFils: 2_125_000,
      vatFils: 0,
      cheque: {
        chequeNo: `SYNTHETIC-${String(index + 1)}`,
        bankName: "Bank (synthetic)",
      },
    })),
    specialClauses: [],
  };
}
export async function runContractSmoke(
  ids: DemoIds,
  options: SmokeOptions,
): Promise<{ contractId: string; status: "concluded"; deliveries: unknown[] }> {
  for (const account of [ids.manager, ids.owner, ids.tenant])
    if (!/^[A-Za-z0-9_-]{43}$/.test(options.sessions[account] ?? ""))
      throw new Error(
        "Verified identity sessions are required for all three accounts",
      );
  const request = options.request ?? globalThis.fetch;
  const print =
    options.print ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const base = (options.baseUrl ?? "http://127.0.0.1:4000").replace(/\/$/u, "");
  let status = "not_created";
  async function step(input: {
    label: string;
    account: string;
    path: string;
    body?: unknown;
    expectedHttp: number;
    expectedStatus?: string;
  }): Promise<Record<string, unknown>> {
    const response = await request(
      `${base}/v1/companies/${ids.companyId}${input.path}`,
      {
        method: input.body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Session ${options.sessions[input.account] ?? ""}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        ...(input.body === undefined
          ? {}
          : { body: JSON.stringify(input.body) }),
      },
    );
    const body = z.record(z.string(), z.unknown()).parse(await response.json());
    if (body.contract)
      status = z.object({ status: z.string() }).parse(body.contract).status;
    print(
      `Synthetic ${input.label}: HTTP ${String(response.status)}; contract ${status}`,
    );
    if (
      response.status !== input.expectedHttp ||
      (input.expectedStatus && status !== input.expectedStatus)
    )
      throw new Error(`Synthetic ${input.label} returned an unexpected result`);
    return body;
  }
  const created = await step({
    label: "draft",
    account: ids.manager,
    path: "/contracts",
    body: demoDraft(ids, (options.now ?? (() => new Date()))()),
    expectedHttp: 201,
    expectedStatus: "draft",
  });
  const contractId = z.object({ id: z.uuid() }).parse(created.contract).id;
  const submitted = await step({
    label: "submit",
    account: ids.manager,
    path: `/contracts/${contractId}/submit`,
    body: { expectedVersion: 1 },
    expectedHttp: 200,
    expectedStatus: "awaiting_owner_approval",
  });
  const subjectHash = z
    .object({ contentHash: z.string() })
    .parse(submitted.version).contentHash;
  await step({
    label: "owner approval",
    account: ids.owner,
    path: `/contracts/${contractId}/owner-approval`,
    body: { expectedVersion: 1, subjectHash },
    expectedHttp: 200,
    expectedStatus: "awaiting_tenant_acceptance",
  });
  await step({
    label: "tenant acceptance",
    account: ids.tenant,
    path: `/contracts/${contractId}/tenant-acceptance`,
    body: { expectedVersion: 1, subjectHash },
    expectedHttp: 200,
    expectedStatus: "concluded",
  });
  await step({
    label: "owner notifications",
    account: ids.owner,
    path: "/notifications",
    expectedHttp: 200,
  });
  await step({
    label: "tenant notifications",
    account: ids.tenant,
    path: "/notifications",
    expectedHttp: 200,
  });
  const detail = await step({
    label: "manager detail",
    account: ids.manager,
    path: `/contracts/${contractId}`,
    expectedHttp: 200,
    expectedStatus: "concluded",
  });
  const deliveries = z
    .array(
      z.object({
        channel: z.string(),
        templateCode: z.string(),
        status: z.string(),
        lastErrorCode: z.string().nullable(),
      }),
    )
    .parse(detail.deliveries);
  print(`Synthetic deliveries: ${JSON.stringify(deliveries)}`);
  return { contractId, status: "concluded", deliveries };
}
