import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { sha256Hex } from "@aqarak/api/models";
import { containedPath, itemIdSchema } from "../paths";
import { mixatLabelSchema } from "./mixat";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const entry = z.tuple([
  itemIdSchema,
  hash,
  z.enum(["Arabic", "CS", "English", "ar_eg", "en_us"]),
]);
const splitSchema = z.object({
  dataset: z.literal("speech-splits-v1"),
  screening: z.array(entry).min(1),
  held_out: z.array(entry).min(1),
  screening_sha256: hash,
  held_out_sha256: hash,
  sources: z.array(
    z.object({ name: z.enum(["mixat", "fleurs"]), manifest_sha256: hash }),
  ),
});
const manifestSchema = z.object({
  files: z.array(z.object({ path: z.string(), sha256: hash })),
});
const fleursLabelSchema = z.object({
  id: itemIdSchema,
  lang: z.enum(["ar_eg", "en_us"]),
  file: z.string(),
  transcription: z.string(),
  num_samples: z.number().int().positive(),
});
export interface SpeechLabel {
  readonly id: string;
  readonly language: string;
  readonly transcript: string;
  readonly duration_ms: number;
}
export interface HeldOutSpeechLabel extends SpeechLabel {
  readonly path: string;
}

function requireMatch(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function json(bytes: Uint8Array): unknown {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}

/** I verify both frozen splits, source manifests, labels and every selected audio hash before collection. */
export async function loadHeldOutSpeech(options: {
  readonly dataDir: string;
  readonly splitsPath: string;
  readonly readBytes?: (path: string) => Promise<Uint8Array>;
}): Promise<{
  readonly clips: readonly HeldOutSpeechLabel[];
  readonly manifestSha256: string;
  readonly splitSha256: string;
}> {
  const read = options.readBytes ?? readFile;
  const splitBytes = await read(options.splitsPath);
  const split = splitSchema.parse(json(splitBytes));
  const used = new Set<string>();
  for (const name of ["screening", "held_out"] as const) {
    requireMatch(
      sha256Hex(
        JSON.stringify(split[name].map(([id, audioHash]) => [id, audioHash])),
      ) === split[`${name}_sha256`],
      "Speech split hash mismatch",
    );
    for (const [id] of split[name]) {
      requireMatch(!used.has(id), "Speech splits overlap or repeat an id");
      used.add(id);
    }
  }
  requireMatch(
    split.sources.length === 2 &&
      new Set(split.sources.map((source) => source.name)).size === 2,
    "Speech source manifest membership mismatch",
  );
  const labels = new Map<
    string,
    HeldOutSpeechLabel & { readonly audioHash: string }
  >();
  for (const source of split.sources) {
    const directory = join(options.dataDir, source.name);
    const bytes = await read(join(directory, "manifest.json"));
    requireMatch(
      sha256Hex(bytes) === source.manifest_sha256,
      "Speech source manifest hash mismatch",
    );
    const manifest = manifestSchema.parse(json(bytes));
    const files = new Map(
      manifest.files.map((file) => [file.path, file.sha256]),
    );
    requireMatch(
      files.size === manifest.files.length,
      "Duplicate speech manifest path",
    );
    const labelBytes = await read(join(directory, "labels.jsonl"));
    requireMatch(
      sha256Hex(labelBytes) === files.get("labels.jsonl"),
      "Speech labels hash mismatch",
    );
    for (const line of Buffer.from(labelBytes)
      .toString("utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "")) {
      const value: unknown = JSON.parse(line);
      const label =
        source.name === "mixat"
          ? mixatLabelSchema.parse(value)
          : fleursLabelSchema.parse(value);
      requireMatch(!labels.has(label.id), "Duplicate speech label id");
      const audioHash = files.get(label.file);
      requireMatch(
        audioHash !== undefined,
        "Speech audio missing from source manifest",
      );
      labels.set(label.id, {
        id: label.id,
        language: "lang" in label ? label.lang : label.language,
        transcript:
          "transcription" in label ? label.transcription : label.transcript,
        duration_ms:
          "num_samples" in label ? label.num_samples / 16 : label.duration_ms,
        path: containedPath(directory, label.file),
        audioHash,
      });
    }
  }
  requireMatch(
    labels.size === used.size && [...labels.keys()].every((id) => used.has(id)),
    "Speech frozen membership differs from source labels",
  );
  for (const [id, audioHash, language] of [
    ...split.screening,
    ...split.held_out,
  ]) {
    const label = labels.get(id);
    requireMatch(
      label?.language === language && label.audioHash === audioHash,
      "Speech label metadata differs from frozen split",
    );
    requireMatch(
      sha256Hex(await read(label.path)) === audioHash,
      "Speech audio hash mismatch",
    );
  }
  return {
    clips: split.held_out.map(([id]) => {
      const label = labels.get(id);
      requireMatch(label !== undefined, "Missing held-out speech label");
      return label;
    }),
    manifestSha256: sha256Hex(splitBytes),
    splitSha256: split.held_out_sha256,
  };
}
