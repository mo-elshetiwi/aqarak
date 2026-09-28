import { expect, it, vi } from "vitest";
import {
  createModelGateway,
  DigestMismatchError,
  toStrictJsonSchema,
} from "@aqarak/api/models";
import {
  fakeCandidate,
  fakeRegistry,
  fakeRequest,
  TEST_SCHEMA,
} from "../test-fixtures";
import { createOllamaAdapter, verifyOllamaDigest } from "./ollama";

it("builds reproducible local requests with strict schema and base64 images", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json({
      model: "fake-model",
      message: { content: '{"value":"synthetic"}' },
      done: true,
      prompt_eval_count: 70,
      eval_count: 24,
    }),
  );
  const request = fakeRequest();
  const result = await createOllamaAdapter({
    host: "http://example.invalid/",
    fetch,
  }).generate({
    candidate: fakeCandidate("ollama"),
    instructions: request.instructions,
    userText: request.userText,
    images: request.images,
    jsonSchema: toStrictJsonSchema(TEST_SCHEMA, "test"),
    signal: new AbortController().signal,
  });
  expect(fetch.mock.calls[0]?.[0]).toBe("http://example.invalid/api/chat");
  const body = fetch.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Missing body");
  expect(JSON.parse(body)).toEqual({
    model: "fake-model",
    messages: [
      { role: "system", content: request.instructions },
      { role: "user", content: request.userText, images: ["AQID"] },
    ],
    format: toStrictJsonSchema(TEST_SCHEMA, "test").schema,
    stream: false,
    think: false,
    keep_alive: "10m",
    options: {
      temperature: 0,
      seed: 20260928,
      num_ctx: 8192,
      num_predict: 3072,
    },
  });
  expect(result.usage).toMatchObject({ inputTokens: 70, outputTokens: 24 });
});
it("AC-7 counts empty content as schema failure with one retry and summed usage", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => {
      await Promise.resolve();
      return Response.json({
        model: "fake-model",
        message: { content: "" },
        done: true,
        prompt_eval_count: 70,
        eval_count: 24,
      });
    });
  const gateway = createModelGateway({
    registry: fakeRegistry("ollama"),
    structuredAdapters: {
      ollama: createOllamaAdapter({ host: "http://example.invalid", fetch }),
    },
    transcriptionAdapters: {},
    now: () => new Date(),
  });
  const result = await gateway.generateStructured(fakeRequest());
  expect(result.record).toMatchObject({
    status: "schema_invalid",
    retries: 1,
    costMicroUsd: 38,
    usage: { inputTokens: 140, outputTokens: 48 },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("AC-7 rejects a missing or mismatched digest and accepts an exact normalized digest", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ models: [] }))
    .mockResolvedValueOnce(
      Response.json({ models: [{ name: "fake-model", digest: "other" }] }),
    )
    .mockResolvedValueOnce(
      Response.json({ models: [{ name: "fake-model", digest: "fake" }] }),
    );
  const options = {
    host: "http://example.invalid",
    fetch,
    modelId: "fake-model",
    expectedDigest: "sha256:fake",
  };
  await expect(verifyOllamaDigest(options)).rejects.toThrow(
    DigestMismatchError,
  );
  await expect(verifyOllamaDigest(options)).rejects.toThrow(
    DigestMismatchError,
  );
  await expect(verifyOllamaDigest(options)).resolves.toBeUndefined();
});
