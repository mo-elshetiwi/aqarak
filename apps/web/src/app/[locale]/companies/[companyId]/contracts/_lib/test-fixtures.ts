import { randomBytes } from "node:crypto";
import { createMockApi, createMockState } from "@/lib/api/mock-adapter";
import {
  MOCK_ACCOUNTS,
  MOCK_COMPANY_A_ID,
  MOCK_ONLY_PASSWORD,
} from "@/lib/api/mock-fixtures";
import {
  createContractsMock,
  createContractsMockState,
  mockDraftingOptions,
} from "./contracts-mock";
import type { DraftInput } from "./schemas";
export const company = MOCK_COMPANY_A_ID;
export function key(): string {
  return randomBytes(24).toString("base64url");
}
export function draft(): DraftInput {
  const tenant = mockDraftingOptions.tenants[0];
  const unit = mockDraftingOptions.units[0];
  if (!tenant || !unit) throw new Error("Missing synthetic fixtures");
  return {
    tenantId: tenant.id,
    unitId: unit.id,
    termStart: "2026-10-01",
    termEnd: "2027-09-30",
    graceDays: 0,
    annualRentFils: 8500000,
    totalFils: 8500000,
    depositFils: 425000,
    vatBp: 0,
    instalments: [1, 2, 3, 4].map((seqNo) => ({
      seqNo,
      dueOn:
        ["2026-10-01", "2027-01-01", "2027-04-01", "2027-07-01"][seqNo - 1] ??
        "2026-10-01",
      amountFils: 2125000,
      vatFils: 0,
      cheque: { chequeNo: `10000${String(seqNo)}`, bankName: "Synthetic Bank" },
    })),
    specialClauses: [],
  };
}
export function setupMock(): {
  api: ReturnType<typeof createContractsMock>;
  state: ReturnType<typeof createContractsMockState>;
  login: (handle: string) => Promise<string>;
} {
  const auth = createMockApi({ state: createMockState() });
  const state = createContractsMockState();
  return {
    api: createContractsMock({ state, auth }),
    state,
    async login(handle) {
      const account = MOCK_ACCOUNTS.find((entry) => entry.handle === handle);
      if (!account) throw new Error("Missing synthetic account");
      const result = await auth.signIn({
        email: account.email,
        password: MOCK_ONLY_PASSWORD,
        client: "web",
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.value.session.id;
    },
  };
}
