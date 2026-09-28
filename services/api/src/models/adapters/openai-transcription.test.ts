import { expect, it, vi } from "vitest";
import { createOpenAiTranscriptionAdapter } from "./openai-transcription";
import { fakeAudioInput } from "../test-fixtures";
it("parses language and billed duration and sends multipart fields", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json({
      text: "synthetic text",
      languages: [{ code: "ar" }],
      usage: { type: "duration", seconds: 5 },
    }),
  );
  const result = await createOpenAiTranscriptionAdapter({
    apiKey: "fake-key",
    baseUrl: "https://example.invalid",
    fetch,
  }).transcribe(fakeAudioInput());
  expect(result).toMatchObject({
    text: "synthetic text",
    detectedLanguage: "ar",
    usage: { audioSeconds: 5 },
  });
  const form = fetch.mock.calls[0]?.[1]?.body;
  expect(form).toBeInstanceOf(FormData);
  if (!(form instanceof FormData)) throw new Error("Missing form");
  expect(form.get("model")).toBe("fake-model");
  expect(form.get("response_format")).toBe("json");
  expect(form.get("file")).toBeInstanceOf(Blob);
  expect(form.has("language")).toBe(false);
});
it("uses input duration if billed duration is absent", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ text: "synthetic" }));
  const result = await createOpenAiTranscriptionAdapter({
    apiKey: "fake-key",
    baseUrl: "https://example.invalid",
    fetch,
  }).transcribe(fakeAudioInput());
  expect(result.usage.audioSeconds).toBe(5);
  expect(result.detectedLanguage).toBeNull();
});
