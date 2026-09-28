import { expect, it, vi } from "vitest";
import type {
  StartStreamTranscriptionCommand,
  StartStreamTranscriptionCommandOutput,
  TranscriptResultStream,
} from "@aws-sdk/client-transcribe-streaming";
import { createAmazonTranscribeStreamingAdapter } from "./amazon-transcribe-streaming";
import { fakeAudioInput, fakeWav } from "../test-fixtures";
import { pcmFromWav } from "../wav";
async function* events(): AsyncGenerator<TranscriptResultStream> {
  await Promise.resolve();
  yield {
    TranscriptEvent: {
      Transcript: {
        Results: [
          { IsPartial: true, Alternatives: [{ Transcript: "discard" }] },
        ],
      },
    },
  };
  yield {
    TranscriptEvent: {
      Transcript: {
        Results: [
          {
            IsPartial: false,
            LanguageCode: "ar-AE",
            Alternatives: [{ Transcript: "first" }],
          },
          {
            IsPartial: false,
            LanguageCode: "en-US",
            Alternatives: [{ Transcript: "second" }],
          },
        ],
      },
    },
  };
}
it("AC-6 sends paced PCM and joins only final transcripts", async () => {
  const lengths: number[] = [];
  const sleep = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn(
    async (
      command: StartStreamTranscriptionCommand,
    ): Promise<StartStreamTranscriptionCommandOutput> => {
      expect(command.input).toMatchObject({
        IdentifyLanguage: true,
        LanguageOptions: "ar-AE,en-US",
        PreferredLanguage: "ar-AE",
        MediaSampleRateHertz: 16000,
      });
      for await (const chunk of command.input.AudioStream ?? [])
        lengths.push(chunk.AudioEvent?.AudioChunk?.length ?? 0);
      return { $metadata: {}, TranscriptResultStream: events() };
    },
  );
  const result = await createAmazonTranscribeStreamingAdapter({
    client: { send },
    sleep,
  }).transcribe(fakeAudioInput("amazon_transcribe_streaming"));
  expect(result.text).toBe("first second");
  expect(result.detectedLanguage).toBe("en-US");
  expect(result.usage.audioSeconds).toBe(0.2);
  expect(lengths).toEqual([3200, 3200]);
  expect(sleep).toHaveBeenNthCalledWith(1, 100);
});
it("AC-6 falls back once when language identification is rejected", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("Language identification unavailable"), {
        name: "BadRequestException",
      }),
    )
    .mockResolvedValueOnce({ $metadata: {}, TranscriptResultStream: events() });
  const result = await createAmazonTranscribeStreamingAdapter({
    client: { send },
    sleep: vi.fn().mockResolvedValue(undefined),
  }).transcribe(fakeAudioInput("amazon_transcribe_streaming"));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]?.[0]).toMatchObject({
    input: { LanguageCode: "ar-AE" },
  });
  expect(result.effectiveParameters).toMatchObject({
    languageIdentificationFallback: true,
    identifyLanguage: false,
    languageCode: "ar-AE",
  });
});
it("validates WAV format before streaming", () => {
  expect(pcmFromWav(fakeWav()).length).toBe(6400);
  expect(() => pcmFromWav(new Uint8Array([1, 2]))).toThrow();
  const invalid = Buffer.from(fakeWav());
  invalid.writeUInt32LE(44100, 24);
  expect(() => pcmFromWav(invalid)).toThrow();
});
