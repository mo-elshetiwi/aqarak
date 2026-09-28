import { StartStreamTranscriptionCommand } from "@aws-sdk/client-transcribe-streaming";
import type {
  AudioStream,
  StartStreamTranscriptionCommandOutput,
} from "@aws-sdk/client-transcribe-streaming";
import { z } from "zod";
import { ProviderResponseError, ProviderUnavailableError } from "../errors";
import { pcmFromWav } from "../wav";
import { ZERO_USAGE } from "../cost";
import { transcribeParametersSchema } from "../registry";
import type {
  TranscriptionAdapter,
  TranscriptionAdapterInput,
  TranscriptionAdapterResult,
} from "../contracts";
export interface TranscribeClient {
  readonly send: (
    command: StartStreamTranscriptionCommand,
    options?: { readonly abortSignal?: AbortSignal },
  ) => Promise<StartStreamTranscriptionCommandOutput>;
}
interface Options {
  readonly client: TranscribeClient;
  readonly sleep: (milliseconds: number) => Promise<void>;
}
const resultSchema = z.object({
  TranscriptEvent: z
    .object({
      Transcript: z
        .object({
          Results: z
            .array(
              z.object({
                IsPartial: z.boolean().optional(),
                LanguageCode: z.string().optional(),
                Alternatives: z
                  .array(z.object({ Transcript: z.string().optional() }))
                  .optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
const errorSchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  $metadata: z
    .object({
      httpStatusCode: z.number().optional(),
      attempts: z.number().optional(),
    })
    .optional(),
});
function identificationRejected(error: unknown): boolean {
  const parsed = errorSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.name === "BadRequestException" &&
    /language|identify/i.test(parsed.data.message ?? "")
  );
}
async function* chunks(
  pcm: Uint8Array,
  options: Options,
  signal: AbortSignal,
  factor: number,
): AsyncGenerator<AudioStream> {
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    signal.throwIfAborted();
    yield { AudioEvent: { AudioChunk: pcm.subarray(offset, offset + 3200) } };
    await options.sleep(100 / factor);
  }
}
async function collect(
  output: StartStreamTranscriptionCommandOutput,
): Promise<{ readonly text: string; readonly language: string | null }> {
  const transcripts: string[] = [];
  let language: string | null = null;
  if (!output.TranscriptResultStream) throw new ProviderResponseError();
  for await (const event of output.TranscriptResultStream) {
    const parsed = resultSchema.safeParse(event);
    if (!parsed.success || !parsed.data.TranscriptEvent)
      throw new ProviderResponseError();
    for (const result of parsed.data.TranscriptEvent.Transcript?.Results ??
      []) {
      if (result.IsPartial !== false) continue;
      const text = result.Alternatives?.[0]?.Transcript;
      if (text) transcripts.push(text.trim());
      language = result.LanguageCode ?? language;
    }
  }
  return { text: transcripts.join(" "), language };
}
async function execute(
  options: Options,
  input: TranscriptionAdapterInput,
  fallback: boolean,
): Promise<TranscriptionAdapterResult> {
  const parsed = transcribeParametersSchema.safeParse(
    input.candidate.parameters,
  );
  if (!parsed.success) throw new ProviderResponseError();
  const p = parsed.data;
  const pcm = pcmFromWav(input.audio.bytes);
  const language = fallback
    ? { LanguageCode: p.preferredLanguage }
    : {
        IdentifyLanguage: true,
        LanguageOptions: p.languageOptions.join(","),
        PreferredLanguage: p.preferredLanguage,
      };
  const output = await options.client.send(
    new StartStreamTranscriptionCommand({
      ...language,
      MediaEncoding: p.mediaEncoding,
      MediaSampleRateHertz: p.sampleRateHertz,
      AudioStream: chunks(pcm, options, input.signal, p.realtimeFactor),
    }),
    { abortSignal: input.signal },
  );
  const result = await collect(output);
  return {
    text: result.text,
    detectedLanguage: result.language,
    usage: { ...ZERO_USAGE, audioSeconds: pcm.length / 32000 },
    modelEcho: null,
    effectiveParameters: {
      ...p,
      identifyLanguage: !fallback,
      languageIdentificationFallback: fallback,
      languageCode: fallback ? p.preferredLanguage : null,
    },
    transportRetries: Math.max(0, (output.$metadata.attempts ?? 1) - 1),
  };
}
/** Create a paced streaming adapter with one documented language-identification fallback. */
export function createAmazonTranscribeStreamingAdapter(
  options: Options,
): TranscriptionAdapter {
  return {
    async transcribe(input) {
      try {
        return await execute(options, input, false);
      } catch (error) {
        try {
          if (identificationRejected(error))
            return await execute(options, input, true);
          throw error;
        } catch (cause) {
          if (cause instanceof ProviderResponseError) throw cause;
          const parsed = errorSchema.safeParse(cause);
          const status = parsed.success
            ? parsed.data.$metadata?.httpStatusCode
            : undefined;
          const transportRetries = parsed.success
            ? Math.max(0, (parsed.data.$metadata?.attempts ?? 1) - 1)
            : 0;
          if (status !== undefined && status < 500 && status !== 429)
            throw new ProviderResponseError({
              cause,
              status,
              transportRetries,
            });
          throw new ProviderUnavailableError({
            cause,
            ...(status === undefined ? {} : { status }),
            transportRetries,
          });
        }
      }
    },
  };
}
