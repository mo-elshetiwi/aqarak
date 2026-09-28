import type { DataApiExecutor, ExecuteResult, Parameter } from "./data-api.ts";

export const CONTEXT_SQL =
  "select set_config('app.company_id', :company_id, true) as company_context, set_config('app.account_id', :account_id, true) as account_context";
export interface CompanyTransaction {
  execute(sql: string, params?: readonly Parameter[]): Promise<ExecuteResult>;
}
export async function withCompanyTx<T>(
  executor: DataApiExecutor,
  context: { companyId: string; accountId: string | null },
  fn: (transaction: CompanyTransaction) => Promise<T>,
): Promise<T> {
  const id = await executor.begin();
  try {
    await executor.execute(
      CONTEXT_SQL,
      [
        { name: "company_id", value: context.companyId },
        { name: "account_id", value: context.accountId ?? "" },
      ],
      id,
    );
    const result = await fn({
      execute: (sql, params) => executor.execute(sql, params, id),
    });
    await executor.commit(id);
    return result;
  } catch (error) {
    await executor.rollback(id).catch(() => undefined);
    throw error;
  }
}
export function withSystemTx<T>(
  executor: DataApiExecutor,
  context: { companyId: string },
  fn: (transaction: CompanyTransaction) => Promise<T>,
): Promise<T> {
  return withCompanyTx(executor, { ...context, accountId: null }, fn);
}
