import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256Hex } from "@aqarak/api/models";
import { fakeWav, temporaryDirectory } from "./test-fixtures";
import { prepareAudio } from "./audio";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("normalizes once with ffmpeg and reuses the identical validated PCM file", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  const sourcePath = join(root, "source.audio");
  await writeFile(sourcePath, "synthetic audio source");
  const run = vi.fn(async (args: readonly string[]): Promise<void> => {
    const output = args.at(-1);
    if (!output) throw new Error("Missing output");
    await writeFile(output, fakeWav());
  });
  const options = { sourcePath, cacheDir: join(root, "cache"), run };
  const [first, concurrent] = await Promise.all([
    prepareAudio(options),
    prepareAudio(options),
  ]);
  const second = await prepareAudio(options);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0].slice(0, -1)).toEqual([
    "-nostdin",
    "-y",
    "-i",
    sourcePath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
  ]);
  expect(first).toEqual(second);
  expect(concurrent).toEqual(first);
  expect(first.durationMs).toBe(200);
  expect(first.sha256).toBe(sha256Hex(fakeWav()));
});
