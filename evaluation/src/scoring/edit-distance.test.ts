import { describe, expect, it } from "vitest";
import {
  alignSequences,
  characterErrors,
  wordErrors,
} from "./edit-distance.js";

describe("alignSequences", () => {
  it("counts identical units as hits", () => {
    expect(alignSequences(["a", "b"], ["a", "b"])).toEqual({
      hits: 2,
      substitutions: 0,
      deletions: 0,
      insertions: 0,
    });
  });
  it("counts a substitution", () => {
    expect(alignSequences(["a"], ["b"])).toEqual({
      hits: 0,
      substitutions: 1,
      deletions: 0,
      insertions: 0,
    });
  });
  it("counts an insertion", () => {
    expect(alignSequences(["a"], ["a", "b"])).toEqual({
      hits: 1,
      substitutions: 0,
      deletions: 0,
      insertions: 1,
    });
  });
  it("counts a deletion", () => {
    expect(alignSequences(["a", "b"], ["a"])).toEqual({
      hits: 1,
      substitutions: 0,
      deletions: 1,
      insertions: 0,
    });
  });
  it("handles empty sequences", () => {
    expect(alignSequences([], null)).toEqual({
      hits: 0,
      substitutions: 0,
      deletions: 0,
      insertions: 0,
    });
    expect(alignSequences([], [1, 2]).insertions).toBe(2);
  });
  it("uses deterministic diagonal tie breaking", () => {
    expect(alignSequences(["a", "b"], ["b", "a"])).toEqual({
      hits: 0,
      substitutions: 2,
      deletions: 0,
      insertions: 0,
    });
  });
});

describe("wordErrors", () => {
  it("counts one substitution, deletion and insertion after normalisation", () => {
    const reference = "ONE two three FOUR five six seven";
    const hypothesis = "one wrong three five six extra seven؟";
    expect(
      alignSequences(reference.toLowerCase().split(" "), [
        "one",
        "wrong",
        "three",
        "five",
        "six",
        "extra",
        "seven",
      ]),
    ).toEqual({ hits: 5, substitutions: 1, deletions: 1, insertions: 1 });
    const result = wordErrors(reference, hypothesis);
    expect(result).toEqual({ edits: 3, referenceWords: 7 });
    expect(result.edits / result.referenceWords).toBe(3 / 7);
  });
  it("counts every reference word as a deletion for a null or empty hypothesis", () => {
    expect(wordErrors("أهلًا يا عالم", null)).toEqual({
      edits: 3,
      referenceWords: 3,
    });
    expect(wordErrors("أهلًا يا عالم", "")).toEqual({
      edits: 3,
      referenceWords: 3,
    });
  });
  it("normalises identical strings", () => {
    expect(wordErrors("أهلًا [HELLO] ١٩", "اهلا hello 19")).toEqual({
      edits: 0,
      referenceWords: 3,
    });
  });
});

describe("characterErrors", () => {
  it("includes normalised spaces", () => {
    expect(characterErrors("a b", "ab")).toEqual({
      edits: 1,
      referenceCharacters: 3,
    });
  });
  it("counts null and identical hypotheses", () => {
    expect(characterErrors("أ ب", null)).toEqual({
      edits: 3,
      referenceCharacters: 3,
    });
    expect(characterErrors("أ ب", "ا ب")).toEqual({
      edits: 0,
      referenceCharacters: 3,
    });
  });
  it("uses Unicode code points", () => {
    expect(characterErrors("𐐀", null)).toEqual({
      edits: 1,
      referenceCharacters: 1,
    });
  });
});
