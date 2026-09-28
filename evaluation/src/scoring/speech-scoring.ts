import { characterErrors, wordErrors } from "./edit-distance.js";
import {
  clusterBootstrapRatio,
  pairedBootstrapDifference,
} from "./statistics.js";
import type { Interval } from "./statistics.js";
import { requireValid } from "./validation.js";

export interface SpeechClip {
  readonly clipId: string;
  readonly language: string;
  readonly reference: string;
  readonly hypothesis: string | null;
  readonly status: string;
}

export interface SpeechClipScore {
  readonly clipId: string;
  readonly language: string;
  readonly wordEdits: number;
  readonly referenceWords: number;
  readonly characterEdits: number;
  readonly referenceCharacters: number;
  readonly status: string;
}

export interface SpeechScore {
  readonly clips: readonly SpeechClipScore[];
  readonly summary: {
    readonly wer: Interval | null;
    readonly cer: Interval | null;
    readonly perLanguageWer: Readonly<Record<string, Interval | null>>;
    readonly statusCounts: Readonly<Record<string, number>>;
  };
}

function uniqueClips(clips: readonly { readonly clipId: string }[]): void {
  if (new Set(clips.map((clip) => clip.clipId)).size < clips.length)
    throw new Error("Clip ids must be unique within a candidate.");
}

function wordCluster(clip: SpeechClipScore): {
  readonly numerator: number;
  readonly denominator: number;
} {
  return { numerator: clip.wordEdits, denominator: clip.referenceWords };
}

/** Scores clips without retaining text, treating every status other than ok as a fully deleted hypothesis. */
export function scoreSpeech(clips: readonly SpeechClip[]): SpeechScore {
  uniqueClips(clips);
  const scores = clips.map((clip): SpeechClipScore => {
    const hypothesis = clip.status === "ok" ? clip.hypothesis : null;
    const words = wordErrors(clip.reference, hypothesis);
    const characters = characterErrors(clip.reference, hypothesis);
    return {
      clipId: clip.clipId,
      language: clip.language,
      wordEdits: words.edits,
      referenceWords: words.referenceWords,
      characterEdits: characters.edits,
      referenceCharacters: characters.referenceCharacters,
      status: clip.status,
    };
  });
  const languages = [...new Set(scores.map((clip) => clip.language))].sort();
  const statuses = [...new Set(scores.map((clip) => clip.status))].sort();
  return {
    clips: scores,
    summary: {
      wer: clusterBootstrapRatio(scores.map(wordCluster)),
      cer: clusterBootstrapRatio(
        scores.map((clip) => ({
          numerator: clip.characterEdits,
          denominator: clip.referenceCharacters,
        })),
      ),
      perLanguageWer: Object.fromEntries(
        languages.map((language) => [
          language,
          clusterBootstrapRatio(
            scores
              .filter((clip) => clip.language === language)
              .map(wordCluster),
          ),
        ]),
      ),
      statusCounts: Object.fromEntries(
        statuses.map((status) => [
          status,
          scores.filter((clip) => clip.status === status).length,
        ]),
      ),
    },
  };
}

/** Compares pooled WER a minus b using shared clip ids and paired bootstrap resampling. */
export function compareSpeechCandidates(
  a: readonly SpeechClipScore[],
  b: readonly SpeechClipScore[],
): Interval | null {
  uniqueClips(a);
  uniqueClips(b);
  const byId = new Map(b.map((clip) => [clip.clipId, clip]));
  const pairs = [...a]
    .sort((left, right) =>
      left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0,
    )
    .flatMap((clip) => {
      const other = byId.get(clip.clipId);
      if (other === undefined) return [];
      requireValid(
        clip.referenceWords === other.referenceWords &&
          clip.language === other.language,
        `Reference metadata differs for clip ${clip.clipId}.`,
      );
      return [{ a: wordCluster(clip), b: wordCluster(other) }];
    });
  return pairedBootstrapDifference(pairs);
}
