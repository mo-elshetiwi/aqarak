import type { ContractDetail } from "./schemas";
type Version = ContractDetail["version"];
export type Change =
  | {
      kind: "date" | "money" | "number" | "vat";
      field: string;
      before: string | number;
      after: string | number;
    }
  | {
      kind: "instalment";
      number: number;
      before: Version["instalments"][number] | null;
      after: Version["instalments"][number] | null;
    }
  | {
      kind: "clause";
      number: number;
      before: Version["specialClauses"][number] | null;
      after: Version["specialClauses"][number] | null;
    };
export function termChanges(before: Version, after: Version): Change[] {
  const changes: Change[] = [];
  for (const field of ["termStart", "termEnd"] as const)
    if (before[field] !== after[field])
      changes.push({
        kind: "date",
        field,
        before: before[field],
        after: after[field],
      });
  for (const field of ["annualRentFils", "totalFils", "depositFils"] as const)
    if (before[field] !== after[field])
      changes.push({
        kind: "money",
        field,
        before: before[field],
        after: after[field],
      });
  if (before.graceDays !== after.graceDays)
    changes.push({
      kind: "number",
      field: "graceDays",
      before: before.graceDays,
      after: after.graceDays,
    });
  if (before.vatBp !== after.vatBp)
    changes.push({
      kind: "vat",
      field: "vatBp",
      before: before.vatBp,
      after: after.vatBp,
    });
  return [
    ...changes,
    ...instalmentChanges(before, after),
    ...clauseChanges(before, after),
  ];
}
function instalmentChanges(before: Version, after: Version): Change[] {
  const changes: Change[] = [];
  const sequences = [
    ...new Set(
      [...before.instalments, ...after.instalments].map((item) => item.seqNo),
    ),
  ].sort((a, b) => a - b);
  for (const number of sequences) {
    const old =
      before.instalments.find((item) => item.seqNo === number) ?? null;
    const current =
      after.instalments.find((item) => item.seqNo === number) ?? null;
    if (instalmentValue(old) !== instalmentValue(current))
      changes.push({ kind: "instalment", number, before: old, after: current });
  }
  return changes;
}
function clauseChanges(before: Version, after: Version): Change[] {
  const changes: Change[] = [];
  const positions = [
    ...new Set(
      [...before.specialClauses, ...after.specialClauses].map(
        (item) => item.position,
      ),
    ),
  ].sort((a, b) => a - b);
  for (const number of positions) {
    const old =
      before.specialClauses.find((item) => item.position === number) ?? null;
    const current =
      after.specialClauses.find((item) => item.position === number) ?? null;
    if (old?.textEn !== current?.textEn || old?.textAr !== current?.textAr)
      changes.push({ kind: "clause", number, before: old, after: current });
  }
  return changes;
}
function instalmentValue(value: Version["instalments"][number] | null): string {
  return JSON.stringify(
    value
      ? [
          value.dueOn,
          value.amountFils,
          value.vatFils,
          value.cheque?.chequeNo,
          value.cheque?.bankName,
        ]
      : null,
  );
}
