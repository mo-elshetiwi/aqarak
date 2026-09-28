import type { Comparison, ResolutionsInput } from "./schemas";
export function comparisonClass(
  row: Comparison,
): "match" | "material" | "minor" | "format_only" | "identity" {
  return row.status === "match" || row.status === "format_only"
    ? row.status
    : row.class;
}
export function sortedComparison(rows: readonly Comparison[]): Comparison[] {
  const rank = (r: Comparison): number =>
    r.status === "match"
      ? 4
      : r.class === "identity"
        ? 0
        : r.class === "material"
          ? 1
          : r.status === "format_only"
            ? 3
            : 2;
  return [...rows].sort((a, b) => rank(a) - rank(b));
}
export function equivalentAllowed(
  row: Pick<Comparison, "class" | "field">,
): boolean {
  return (
    row.class === "minor" &&
    !row.field.endsWith("_fils") &&
    !row.field.includes("id_number") &&
    !["term_start", "term_end", "registered_on", "unt_number"].includes(
      row.field,
    )
  );
}
export function consequence(
  kind: ResolutionsInput["choices"][number]["kind"],
  material: boolean,
  gate: boolean,
):
  | "ownerConsequence"
  | "currentConsequence"
  | "cancelConsequence"
  | "equivalentConsequence" {
  if (kind === "cancel_and_reregister") return "cancelConsequence";
  if (kind === "mark_equivalent") return "equivalentConsequence";
  return material && gate ? "ownerConsequence" : "currentConsequence";
}
