import type { ModelClassId } from "./registry";
export interface BudgetGuard {
  readonly canSpend: (classId: ModelClassId) => boolean;
  readonly add: (classId: ModelClassId, costMicroUsd: number) => void;
  readonly spentMicroUsd: (classId: ModelClassId) => number;
}
/** Track integer spend per class, leaving classes without caps unlimited. */
export function createBudgetGuard(
  capsMicroUsd: Readonly<Partial<Record<ModelClassId, number>>>,
): BudgetGuard {
  for (const cap of Object.values(capsMicroUsd)) validate(cap);
  const spent = new Map<ModelClassId, number>();
  return Object.freeze({
    canSpend: (classId: ModelClassId): boolean =>
      (spent.get(classId) ?? 0) < (capsMicroUsd[classId] ?? Infinity),
    add: (classId: ModelClassId, costMicroUsd: number): void => {
      validate(costMicroUsd);
      const total = (spent.get(classId) ?? 0) + costMicroUsd;
      validate(total);
      spent.set(classId, total);
    },
    spentMicroUsd: (classId: ModelClassId): number => spent.get(classId) ?? 0,
  });
}
function validate(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Budget must be nonnegative integer micro-dollars");
}
