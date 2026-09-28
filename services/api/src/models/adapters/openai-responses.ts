import { z } from "zod";
import { ProviderResponseError } from "../errors";
import { responseParametersSchema } from "../registry";
import type { StructuredAdapter } from "../contracts";
import { parseResponse, postWithRetries } from "./http-transport";
import type { HttpOptions } from "./http-transport";
const responseSchema = z.object({
  status: z.enum([
    "completed",
    "incomplete",
    "failed",
    "cancelled",
    "queued",
    "in_progress",
  ]),
  model: z.string(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("output_text"), text: z.string() }),
            z.object({ type: z.literal("refusal"), refusal: z.string() }),
          ]),
        )
        .optional(),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
      .optional(),
  }),
  incomplete_details: z.object({ reason: z.string() }).nullable().optional(),
});
/** Create a strict structured-output adapter with explicit image input and no stored responses. */
export function createOpenAiResponsesAdapter(
  options: HttpOptions,
): StructuredAdapter {
  return {
    async generate(input) {
      const parameters = responseParametersSchema.safeParse(
        input.candidate.parameters,
      );
      if (!parameters.success) throw new ProviderResponseError();
      const p = parameters.data;
      const body = {
        model: input.candidate.modelId,
        instructions: input.instructions,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: input.userText },
              ...input.images.map((image) => ({
                type: "input_image",
                image_url: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`,
                detail: p.imageDetail ?? "high",
              })),
            ],
          },
        ],
        reasoning: { effort: p.reasoningEffort },
        max_output_tokens: p.maxOutputTokens,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: input.jsonSchema.name,
            strict: true,
            schema: input.jsonSchema.schema,
          },
        },
      };
      const { response, transportRetries } = await postWithRetries(
        options,
        "/responses",
        {
          signal: input.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await parseResponse(
        response,
        responseSchema,
        transportRetries,
      );
      const content = data.output.flatMap((entry) =>
        entry.type === "message" ? (entry.content ?? []) : [],
      );
      const refused = content.some((entry) => entry.type === "refusal");
      if (data.status !== "completed" && data.status !== "incomplete")
        throw new ProviderResponseError({ transportRetries });
      return {
        text: content
          .filter((entry) => entry.type === "output_text")
          .map((entry) => entry.text)
          .join(""),
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          reasoningTokens:
            data.usage.output_tokens_details?.reasoning_tokens ?? 0,
          audioSeconds: 0,
        },
        modelEcho: data.model,
        finish: refused ? "refused" : data.status,
        transportRetries,
      };
    },
  };
}
