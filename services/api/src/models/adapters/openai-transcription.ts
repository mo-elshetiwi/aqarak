import { z } from "zod";
import { ProviderResponseError } from "../errors";
import { ZERO_USAGE } from "../cost";
import type { TranscriptionAdapter } from "../contracts";
import { transcriptionParametersSchema } from "../registry";
import { parseResponse, postWithRetries } from "./http-transport";
import type { HttpOptions } from "./http-transport";
const responseSchema = z.object({
  text: z.string(),
  languages: z.array(z.object({ code: z.string() })).optional(),
  usage: z
    .object({ type: z.string(), seconds: z.number().nonnegative().optional() })
    .optional(),
});
/** Create a multipart transcription adapter using only documented language hints. */
export function createOpenAiTranscriptionAdapter(
  options: HttpOptions,
): TranscriptionAdapter {
  return {
    async transcribe(input) {
      const parameters = transcriptionParametersSchema.safeParse(
        input.candidate.parameters,
      );
      if (!parameters.success) throw new ProviderResponseError();
      const form = new FormData();
      form.set(
        "file",
        new Blob([new Uint8Array(input.audio.bytes)], {
          type: input.audio.mediaType,
        }),
        input.audio.fileName,
      );
      form.set("model", input.candidate.modelId);
      form.set("response_format", parameters.data.responseFormat);
      for (const language of parameters.data.languages ?? [])
        form.append("languages[]", language);
      const { response, transportRetries } = await postWithRetries(
        options,
        "/audio/transcriptions",
        { signal: input.signal, body: form },
      );
      const data = await parseResponse(
        response,
        responseSchema,
        transportRetries,
      );
      return {
        text: data.text,
        detectedLanguage: data.languages?.[0]?.code ?? null,
        usage: {
          ...ZERO_USAGE,
          audioSeconds: data.usage?.seconds ?? input.audio.durationMs / 1000,
        },
        modelEcho: null,
        effectiveParameters: {
          responseFormat: parameters.data.responseFormat,
          ...(parameters.data.languages
            ? { languages: parameters.data.languages }
            : {}),
        },
        transportRetries,
      };
    },
  };
}
