import { z } from "zod";
import {
  DigestMismatchError,
  ProviderResponseError,
  ProviderUnavailableError,
  ollamaParametersSchema,
} from "@aqarak/api/models";
import type { StructuredAdapter } from "@aqarak/api/models";
interface Options {
  readonly host: string;
  readonly fetch: typeof globalThis.fetch;
}
const responseSchema = z.object({
  model: z.string(),
  message: z.object({ content: z.string() }),
  done: z.boolean(),
  prompt_eval_count: z.number().int().nonnegative(),
  eval_count: z.number().int().nonnegative(),
});
async function request(
  options: Options,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await options.fetch(
      `${options.host.replace(/\/$/, "")}${path}`,
      init,
    );
  } catch (cause) {
    throw new ProviderUnavailableError({ cause });
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500)
      throw new ProviderUnavailableError({ status: response.status });
    throw new ProviderResponseError({ status: response.status });
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderResponseError();
  }
}
/** Create a local structured-output adapter with reproducible registry parameters. */
export function createOllamaAdapter(options: Options): StructuredAdapter {
  return {
    async generate(input) {
      const parsed = ollamaParametersSchema.safeParse(
        input.candidate.parameters,
      );
      if (!parsed.success) throw new ProviderResponseError();
      const p = parsed.data;
      const data = responseSchema.safeParse(
        await request(options, "/api/chat", {
          method: "POST",
          signal: input.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: input.candidate.modelId,
            messages: [
              { role: "system", content: input.instructions },
              {
                role: "user",
                content: input.userText,
                images: input.images.map((image) =>
                  Buffer.from(image.bytes).toString("base64"),
                ),
              },
            ],
            format: input.jsonSchema.schema,
            stream: false,
            think: p.think,
            keep_alive: "10m",
            options: {
              temperature: p.temperature,
              seed: p.seed,
              num_ctx: p.numCtx,
              num_predict: p.numPredict,
            },
          }),
        }),
      );
      if (!data.success) throw new ProviderResponseError();
      return {
        text: data.data.message.content,
        usage: {
          inputTokens: data.data.prompt_eval_count,
          outputTokens: data.data.eval_count,
          reasoningTokens: 0,
          audioSeconds: 0,
        },
        modelEcho: data.data.model,
        finish: data.data.done ? "completed" : "incomplete",
        transportRetries: 0,
      };
    },
  };
}
/** Refuse local execution when the advertised weights differ from the registry. */
export async function verifyOllamaDigest(
  options: Options & {
    readonly modelId: string;
    readonly expectedDigest: string;
  },
): Promise<void> {
  const parsed = z
    .object({
      models: z.array(z.object({ name: z.string(), digest: z.string() })),
    })
    .safeParse(await request(options, "/api/tags"));
  if (!parsed.success) throw new ProviderResponseError();
  const actual = parsed.data.models.find(
    (model) => model.name === options.modelId,
  )?.digest;
  const normalize = (digest: string): string =>
    digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
  if (
    actual === undefined ||
    normalize(actual) !== normalize(options.expectedDigest)
  )
    throw new DigestMismatchError();
}
