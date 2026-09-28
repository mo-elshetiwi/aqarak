import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createOpenAiResponsesAdapter } from "./openai-responses";
import { fakeCandidate, fakeRequest } from "../test-fixtures";
import { toStrictJsonSchema } from "../json-schema";
function response(status = "completed", refusal = false): Response {
  return Response.json({
    status,
    model: "fake-model",
    output: [
      {
        type: "message",
        content: [
          refusal
            ? { type: "refusal", refusal: "synthetic refusal" }
            : { type: "output_text", text: '{"value":"synthetic"}' },
        ],
      },
    ],
    usage: {
      input_tokens: 70,
      output_tokens: 24,
      output_tokens_details: { reasoning_tokens: 3 },
    },
    incomplete_details:
      status === "incomplete" ? { reason: "max_output_tokens" } : null,
  });
}
it("AC-2 sends strict schema, image detail, reasoning, store false and no sampling parameter", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
  const request = fakeRequest();
  const result = await createOpenAiResponsesAdapter({
    apiKey: "fake-key",
    baseUrl: "https://example.invalid/v1",
    fetch,
  }).generate({
    ...request,
    candidate: fakeCandidate(),
    jsonSchema: toStrictJsonSchema(request.schema, request.schemaId),
    signal: new AbortController().signal,
  });
  const body = fetch.mock.calls[0]?.[1]?.body;
  expect(typeof body).toBe("string");
  if (typeof body !== "string") throw new Error("Missing test request");
  const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(body));
  if (!parsed.success) throw new Error("Invalid test request");
  expect(parsed.data).toMatchObject({
    model: "fake-model",
    store: false,
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["value"],
        },
      },
    },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text" },
          {
            type: "input_image",
            image_url: "data:image/jpeg;base64,AQID",
            detail: "high",
          },
        ],
      },
    ],
  });
  expect(parsed.data).not.toHaveProperty("temperature");
  expect(parsed.data).not.toHaveProperty("top_p");
  expect(result.usage).toEqual({
    inputTokens: 70,
    outputTokens: 24,
    reasoningTokens: 3,
    audioSeconds: 0,
  });
});
it("counts one transport retry after 429 and honours retry-after", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
    )
    .mockResolvedValueOnce(response());
  const sleep = vi.fn().mockResolvedValue(undefined);
  const request = fakeRequest();
  const result = await createOpenAiResponsesAdapter({
    apiKey: "fake-key",
    baseUrl: "https://example.invalid",
    fetch,
    sleep,
  }).generate({
    ...request,
    candidate: fakeCandidate(),
    jsonSchema: toStrictJsonSchema(request.schema, request.schemaId),
    signal: new AbortController().signal,
  });
  expect(result.transportRetries).toBe(1);
  expect(sleep).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
});
it.each(["refused", "incomplete"] as const)(
  "maps %s results",
  async (finish) => {
    const request = fakeRequest();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(
          finish === "refused" ? "completed" : "incomplete",
          finish === "refused",
        ),
      );
    const result = await createOpenAiResponsesAdapter({
      apiKey: "fake-key",
      baseUrl: "https://example.invalid",
      fetch,
    }).generate({
      ...request,
      candidate: fakeCandidate(),
      jsonSchema: toStrictJsonSchema(request.schema, request.schemaId),
      signal: new AbortController().signal,
    });
    expect(result.finish).toBe(finish);
  },
);
