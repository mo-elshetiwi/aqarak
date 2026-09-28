import { expect, it } from "vitest";
import { join } from "node:path";
import { sha256Hex } from "@aqarak/api/models";
import { loadHeldOutSpeech } from "./held-out-speech";
import { itemIdSchema } from "../paths";

function fixture() {
  const files = new Map<string, Uint8Array>();
  const put = (path: string, value: unknown): string => {
    const bytes = Buffer.from(
      typeof value === "string" ? value : JSON.stringify(value),
    );
    files.set(path, bytes);
    return sha256Hex(bytes);
  };
  const mixatAudio = put("/data/mixat/clip.wav", "mixat audio");
  const heldAudio = put("/data/mixat/held.wav", "held audio");
  const fleursAudio = put("/data/fleurs/ar_eg/1.wav", "fleurs audio");
  const mixatLabels = put(
    "/data/mixat/labels.jsonl",
    [
      { id: "clip", file: "clip.wav" },
      { id: "held", file: "held.wav" },
    ]
      .map((clip) =>
        JSON.stringify({
          ...clip,
          part: 1,
          split: "test",
          language: "Arabic",
          duration_ms: 1000,
          transcript: "private reference",
        }),
      )
      .join("\n"),
  );
  const fleursLabels = put(
    "/data/fleurs/labels.jsonl",
    JSON.stringify({
      id: "ar_eg/1",
      file: "ar_eg/1.wav",
      lang: "ar_eg",
      transcription: "private reference",
      num_samples: 32000,
    }),
  );
  const mixatManifest = put("/data/mixat/manifest.json", {
    files: [
      { path: "clip.wav", sha256: mixatAudio },
      { path: "held.wav", sha256: heldAudio },
      { path: "labels.jsonl", sha256: mixatLabels },
    ],
  });
  const fleursManifest = put("/data/fleurs/manifest.json", {
    files: [
      { path: "ar_eg/1.wav", sha256: fleursAudio },
      { path: "labels.jsonl", sha256: fleursLabels },
    ],
  });
  const screening = [["clip", mixatAudio, "Arabic"]];
  const held_out = [
    ["held", heldAudio, "Arabic"],
    ["ar_eg/1", fleursAudio, "ar_eg"],
  ];
  const split = {
    dataset: "speech-splits-v1",
    sources: [
      { name: "mixat", manifest_sha256: mixatManifest },
      { name: "fleurs", manifest_sha256: fleursManifest },
    ],
    screening,
    held_out,
    screening_sha256: sha256Hex(
      JSON.stringify(screening.map(([id, hash]) => [id, hash])),
    ),
    held_out_sha256: sha256Hex(
      JSON.stringify(held_out.map(([id, hash]) => [id, hash])),
    ),
  };
  put("/split.json", split);
  return {
    files,
    put,
    split,
    options: {
      dataDir: "/data",
      splitsPath: "/split.json",
      readBytes: (path: string) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error(`Missing fixture: ${path}`);
        return Promise.resolve(bytes);
      },
    },
  };
}

it("loads frozen MIXAT and namespaced FLEURS clips in held-out order", async () => {
  const { options, split, files } = fixture();
  const loaded = await loadHeldOutSpeech(options);
  expect(loaded.splitSha256).toBe(split.held_out_sha256);
  expect(loaded.manifestSha256).toBe(
    sha256Hex(files.get("/split.json") ?? new Uint8Array()),
  );
  expect(loaded.clips.map((clip) => clip.id)).toEqual(["held", "ar_eg/1"]);
  expect(loaded.clips[1]).toMatchObject({
    language: "ar_eg",
    duration_ms: 2000,
    path: join("/data/fleurs", "ar_eg/1.wav"),
  });
});
it.each([
  ["/data/mixat/manifest.json", "Speech source manifest hash mismatch"],
  ["/data/fleurs/labels.jsonl", "Speech labels hash mismatch"],
  ["/data/mixat/held.wav", "Speech audio hash mismatch"],
  ["/data/fleurs/ar_eg/1.wav", "Speech audio hash mismatch"],
])("rejects changed source bytes at %s", async (path, message) => {
  const { options, put } = fixture();
  put(path, "tampered");
  await expect(loadHeldOutSpeech(options)).rejects.toThrow(message);
});
it("rejects split corruption and overlap even with recomputed digests", async () => {
  const { options, put, split } = fixture();
  put("/split.json", { ...split, held_out_sha256: "0".repeat(64) });
  await expect(loadHeldOutSpeech(options)).rejects.toThrow(
    "Speech split hash mismatch",
  );
  put("/split.json", {
    ...split,
    held_out: split.screening,
    held_out_sha256: split.screening_sha256,
  });
  await expect(loadHeldOutSpeech(options)).rejects.toThrow(
    "Speech splits overlap",
  );
});
it("accepts frozen namespaced ids and rejects traversal or extra path segments", () => {
  expect(itemIdSchema.safeParse("en_us/123").success).toBe(true);
  for (const id of ["../1", "/ar_eg/1", "ar_eg/../1", "ar_eg/a/b", "other/123"])
    expect(itemIdSchema.safeParse(id).success).toBe(false);
});
