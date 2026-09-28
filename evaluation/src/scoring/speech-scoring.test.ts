import { describe, expect, it } from "vitest";
import { compareSpeechCandidates, scoreSpeech } from "./speech-scoring.js";

describe("scoreSpeech", () => {
  it("pools hand-computed word and character errors by clip", () => {
    const score = scoreSpeech([
      {
        clipId: "1",
        language: "English",
        reference: "a b",
        hypothesis: "a c",
        status: "ok",
      },
      {
        clipId: "2",
        language: "Arabic",
        reference: "أ ب ج",
        hypothesis: "ا ب ج",
        status: "timeout",
      },
      {
        clipId: "3",
        language: "English",
        reference: "a",
        hypothesis: null,
        status: "ok",
      },
    ]);
    expect(score.clips).toEqual([
      {
        clipId: "1",
        language: "English",
        wordEdits: 1,
        referenceWords: 2,
        characterEdits: 1,
        referenceCharacters: 3,
        status: "ok",
      },
      {
        clipId: "2",
        language: "Arabic",
        wordEdits: 3,
        referenceWords: 3,
        characterEdits: 5,
        referenceCharacters: 5,
        status: "timeout",
      },
      {
        clipId: "3",
        language: "English",
        wordEdits: 1,
        referenceWords: 1,
        characterEdits: 1,
        referenceCharacters: 1,
        status: "ok",
      },
    ]);
    expect(score.summary.wer?.estimate).toBe(5 / 6);
    expect(score.summary.cer?.estimate).toBe(7 / 9);
    expect(score.summary.perLanguageWer.Arabic?.estimate).toBe(1);
    expect(score.summary.perLanguageWer.English?.estimate).toBe(2 / 3);
    expect(score.summary.statusCounts).toEqual({ ok: 2, timeout: 1 });
    expect(JSON.stringify(score)).not.toContain("hypothesis");
  });
  it("handles insertions on empty references and entirely empty input", () => {
    const score = scoreSpeech([
      {
        clipId: "1",
        language: "English",
        reference: "",
        hypothesis: "a",
        status: "ok",
      },
    ]);
    expect(score.clips[0]?.wordEdits).toBe(1);
    expect(score.summary.wer).toBeNull();
    expect(scoreSpeech([])).toEqual({
      clips: [],
      summary: { wer: null, cer: null, perLanguageWer: {}, statusCounts: {} },
    });
  });
  it("rejects duplicate clip ids", () => {
    const clip = {
      clipId: "1",
      language: "English",
      reference: "a",
      hypothesis: "a",
      status: "ok",
    };
    expect(() => scoreSpeech([clip, clip])).toThrow("unique");
  });
});

describe("compareSpeechCandidates", () => {
  const a = scoreSpeech([
    {
      clipId: "shared",
      language: "English",
      reference: "a b",
      hypothesis: "a c",
      status: "ok",
    },
    {
      clipId: "only-a",
      language: "English",
      reference: "a b c",
      hypothesis: null,
      status: "error",
    },
  ]).clips;
  const b = scoreSpeech([
    {
      clipId: "shared",
      language: "English",
      reference: "a b",
      hypothesis: "a b",
      status: "ok",
    },
  ]).clips;
  it("pairs shared clip ids and subtracts b from a", () => {
    expect(compareSpeechCandidates(a, b)).toEqual({
      estimate: 0.5,
      lower: 0.5,
      upper: 0.5,
    });
    expect(compareSpeechCandidates(b, a)?.estimate).toBe(-0.5);
  });
  it("returns null without shared clip ids", () => {
    expect(compareSpeechCandidates(a, [])).toBeNull();
  });
  it("rejects mismatched reference metadata and duplicates", () => {
    expect(() =>
      compareSpeechCandidates(
        a,
        b.map((clip) => ({ ...clip, referenceWords: 3 })),
      ),
    ).toThrow("metadata");
    expect(() => compareSpeechCandidates([...a, ...a], b)).toThrow("unique");
  });
});
