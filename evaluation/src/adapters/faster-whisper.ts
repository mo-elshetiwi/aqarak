import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DigestMismatchError,
  ProviderResponseError,
  ProviderUnavailableError,
  ZERO_USAGE,
  whisperParametersSchema,
} from "@aqarak/api/models";
import type {
  ModelCandidate,
  TranscriptionAdapter,
  TranscriptionAdapterResult,
} from "@aqarak/api/models";
export interface BridgeProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly on: (event: "error" | "exit", listener: () => void) => unknown;
  readonly kill: () => boolean;
}
export type BridgeSpawn = (
  executable: string,
  arguments_: readonly string[],
) => BridgeProcess;
interface Options {
  readonly python: string;
  readonly modelsDir: string;
  readonly candidate: ModelCandidate;
  readonly spawn?: BridgeSpawn;
}
const lineSchema = z.strictObject({
  id: z.string(),
  text: z.string().nullable(),
  language: z.string().nullable(),
  language_probability: z.number().min(0).max(1).nullable(),
  duration_s: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
});
type BridgeLine = z.infer<typeof lineSchema>;
interface Pending {
  readonly resolve: (line: BridgeLine) => void;
  readonly reject: (error: Error) => void;
}
export interface WhisperAdapter extends TranscriptionAdapter {
  readonly close: () => void;
  readonly verify: () => Promise<void>;
}
/** Stream the weights file through SHA-256 before allowing local inference. */
export async function verifyWhisperWeights(options: {
  readonly modelDir: string;
  readonly expectedSha256: string;
}): Promise<void> {
  const hash = createHash("sha256");
  try {
    for await (const bytes of createReadStream(
      join(options.modelDir, "model.bin"),
    )) {
      const parsed = z.instanceof(Uint8Array).safeParse(bytes);
      if (!parsed.success) throw new DigestMismatchError();
      hash.update(parsed.data);
    }
  } catch (cause) {
    throw new DigestMismatchError(cause);
  }
  if (hash.digest("hex") !== options.expectedSha256)
    throw new DigestMismatchError();
}
function readLine(line: string): BridgeLine {
  try {
    const parsed = lineSchema.safeParse(JSON.parse(line));
    if (parsed.success) return parsed.data;
  } catch {
    throw new ProviderResponseError();
  }
  throw new ProviderResponseError();
}
/** Keep one verified speech bridge alive for all clips of a candidate. */
export function createFasterWhisperAdapter(options: Options): WhisperAdapter {
  const parsed = whisperParametersSchema.safeParse(
    options.candidate.parameters,
  );
  if (!parsed.success || options.candidate.version.weightsSha256 === null)
    throw new DigestMismatchError();
  const parameters = parsed.data;
  const expectedSha256 = options.candidate.version.weightsSha256;
  const modelDir = join(options.modelsDir, parameters.weightsDirName);
  const pending = new Map<string, Pending>();
  let child: BridgeProcess | undefined;
  let verified: Promise<void> | undefined;
  let closed = false;
  const verify = (): Promise<void> => {
    verified ??= verifyWhisperWeights({ modelDir, expectedSha256 });
    return verified;
  };
  const rejectAll = (error: Error): void => {
    for (const value of pending.values()) value.reject(error);
    pending.clear();
  };
  const close = (): void => {
    closed = true;
    rejectAll(new ProviderUnavailableError());
    child?.stdin.end();
    child?.kill();
  };
  function start(): BridgeProcess {
    if (closed) throw new ProviderUnavailableError();
    if (child) return child;
    const launch =
      options.spawn ??
      ((python: string, args: readonly string[]): BridgeProcess =>
        spawn(python, args, { stdio: ["pipe", "pipe", "pipe"] }));
    child = launch(options.python, [
      fileURLToPath(new URL("../../python/whisper_bridge.py", import.meta.url)),
      "--model-dir",
      modelDir,
      "--compute-type",
      parameters.computeType,
      "--beam-size",
      String(parameters.beamSize),
    ]);
    child.stderr.resume();
    child.on("error", () => {
      closed = true;
      rejectAll(new ProviderUnavailableError());
    });
    child.on("exit", () => {
      closed = true;
      rejectAll(new ProviderUnavailableError());
    });
    child.stdin.on("error", () => {
      closed = true;
      rejectAll(new ProviderUnavailableError());
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const response = readLine(line);
        const waiting = pending.get(response.id);
        if (!waiting) throw new ProviderResponseError();
        pending.delete(response.id);
        waiting.resolve(response);
      } catch {
        rejectAll(new ProviderResponseError());
      }
    });
    return child;
  }
  return {
    verify,
    close,
    async transcribe(input): Promise<TranscriptionAdapterResult> {
      if (
        input.audio.path === null ||
        input.candidate.modelId !== options.candidate.modelId
      )
        throw new ProviderResponseError();
      await verify();
      input.signal.throwIfAborted();
      const process = start();
      const id = randomUUID();
      const abort = (): void => {
        close();
      };
      input.signal.addEventListener("abort", abort, { once: true });
      try {
        const response = await new Promise<BridgeLine>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          process.stdin.write(
            `${JSON.stringify({ id, path: input.audio.path, language: null })}\n`,
          );
        });
        if (
          response.error !== null ||
          response.text === null ||
          response.duration_s === null
        )
          throw new ProviderResponseError();
        return {
          text: response.text,
          detectedLanguage: response.language,
          usage: { ...ZERO_USAGE, audioSeconds: response.duration_s },
          modelEcho: null,
          effectiveParameters: parameters,
          transportRetries: 0,
        };
      } finally {
        input.signal.removeEventListener("abort", abort);
      }
    },
  };
}
