import { normaliseText, tokenise } from "./text-normaliser.js";

export interface Alignment {
  readonly hits: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
}

function distanceMatrix<T>(
  reference: readonly T[],
  returned: readonly T[],
): (row: number, column: number) => number {
  const width = returned.length + 1;
  const matrix = new Float64Array((reference.length + 1) * width);
  const at = (row: number, column: number): number =>
    matrix[row * width + column] ?? 0;
  for (let row = 0; row <= reference.length; row += 1)
    matrix[row * width] = row;
  for (let column = 0; column <= returned.length; column += 1)
    matrix[column] = column;
  for (let row = 1; row <= reference.length; row += 1) {
    for (let column = 1; column <= returned.length; column += 1) {
      matrix[row * width + column] = Math.min(
        at(row - 1, column - 1) +
          (reference[row - 1] === returned[column - 1] ? 0 : 1),
        at(row - 1, column) + 1,
        at(row, column - 1) + 1,
      );
    }
  }
  return at;
}

/** Aligns units using Wagner-Fischer, resolving ties as diagonal, deletion, then insertion. */
export function alignSequences<T>(
  reference: readonly T[],
  hypothesis: readonly T[] | null,
): Alignment {
  const returned = hypothesis ?? [];
  const at = distanceMatrix(reference, returned);
  let row = reference.length;
  let column = returned.length;
  let hits = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (row > 0 || column > 0) {
    const equal = reference[row - 1] === returned[column - 1];
    if (
      row > 0 &&
      column > 0 &&
      at(row, column) === at(row - 1, column - 1) + (equal ? 0 : 1)
    ) {
      hits += equal ? 1 : 0;
      substitutions += equal ? 0 : 1;
      row -= 1;
      column -= 1;
    } else if (row > 0 && at(row, column) === at(row - 1, column) + 1) {
      deletions += 1;
      row -= 1;
    } else {
      insertions += 1;
      column -= 1;
    }
  }
  return { hits, substitutions, deletions, insertions };
}

function edits(alignment: Alignment): number {
  return alignment.substitutions + alignment.deletions + alignment.insertions;
}

/** Counts word edits after normalisation, treating null hypotheses as deletions. */
export function wordErrors(
  referenceText: string,
  hypothesisText: string | null,
): { readonly edits: number; readonly referenceWords: number } {
  const reference = tokenise(referenceText);
  return {
    edits: edits(alignSequences(reference, tokenise(hypothesisText ?? ""))),
    referenceWords: reference.length,
  };
}

/** Counts Unicode character edits after normalisation, including single spaces. */
export function characterErrors(
  referenceText: string,
  hypothesisText: string | null,
): { readonly edits: number; readonly referenceCharacters: number } {
  const reference = Array.from(normaliseText(referenceText));
  return {
    edits: edits(
      alignSequences(
        reference,
        Array.from(normaliseText(hypothesisText ?? "")),
      ),
    ),
    referenceCharacters: reference.length,
  };
}
