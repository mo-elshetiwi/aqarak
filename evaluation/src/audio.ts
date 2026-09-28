import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, access, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  pcmFromWav,
  sha256Hex,
  ProviderUnavailableError,
} from "@aqarak/api/models";
const execute = promisify(execFile);
const preparing = new Map<string, Promise<void>>();
interface AudioOptions {
  readonly sourcePath: string;
  readonly cacheDir: string;
  readonly run?: (arguments_: readonly string[]) => Promise<void>;
}
export interface PreparedAudio {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly durationMs: number;
}
async function normalizeAudio(
  options: AudioOptions,
  path: string,
): Promise<void> {
  await mkdir(options.cacheDir, { recursive: true });
  let exists = true;
  try {
    await access(path);
  } catch {
    exists = false;
  }
  if (!exists) {
    const temporary = join(options.cacheDir, `${randomUUID()}.wav`);
    const run =
      options.run ??
      (async (args: readonly string[]): Promise<void> => {
        await execute("ffmpeg", args, { maxBuffer: 1024 * 1024 });
      });
    try {
      await run([
        "-nostdin",
        "-y",
        "-i",
        options.sourcePath,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        temporary,
      ]);
      pcmFromWav(await readFile(temporary));
      await rename(temporary, path);
    } catch (cause) {
      throw new ProviderUnavailableError({ cause });
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
/** Normalize a source once so every candidate receives identical mono PCM audio. */
export async function prepareAudio(
  options: AudioOptions,
): Promise<PreparedAudio> {
  const source = await readFile(options.sourcePath);
  const hash = sha256Hex(source);
  const path = join(options.cacheDir, `${hash}.wav`);
  let job = preparing.get(path);
  if (!job) {
    job = normalizeAudio(options, path);
    preparing.set(path, job);
  }
  try {
    await job;
  } finally {
    if (preparing.get(path) === job) preparing.delete(path);
  }
  const bytes = await readFile(path);
  const pcm = pcmFromWav(bytes);
  return { path, bytes, sha256: sha256Hex(bytes), durationMs: pcm.length / 32 };
}
