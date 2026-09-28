import { File } from "expo-file-system";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { CapturedMedia } from "@/features/capture/media";
import { commandKey, ReportError, type ReportClient } from "./client";
import type { MediaView, UploadResponse } from "./contract";
export type ReadCaptureBytes = (uri: string) => Promise<Uint8Array>;
/** I read the capture owner's private URI without changing or deleting it. */
export function readCaptureBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}
interface UploadCommand {
  createKey: string;
  completeKey: string;
  upload?: UploadResponse;
  putDone?: boolean;
  completed?: MediaView;
  pending?: Promise<MediaView> | undefined;
}
const commands = new WeakMap<ReportClient, Map<string, UploadCommand>>();
/** I retain successful stages and command keys so a timeout cannot duplicate a captured upload. */
export function uploadCapturedMedia(
  ...[client, companyId, unitId, media, readBytes]: [
    client: ReportClient,
    companyId: string,
    unitId: string,
    media: CapturedMedia,
    readBytes: ReadCaptureBytes,
  ]
): Promise<MediaView> {
  let scoped = commands.get(client);
  if (!scoped) {
    scoped = new Map();
    commands.set(client, scoped);
  }
  const identity = JSON.stringify([companyId, unitId, media.uri]);
  let command = scoped.get(identity);
  if (!command) {
    command = { createKey: commandKey(), completeKey: commandKey() };
    scoped.set(identity, command);
  }
  if (command.completed) return Promise.resolve(command.completed);
  if (command.pending) return command.pending;
  const retained = command;
  async function run(): Promise<MediaView> {
    if (media.kind !== "photo" && media.kind !== "voice_note")
      throw new ReportError("UNSUPPORTED_TYPE");
    const bytes = await readBytes(media.uri);
    retained.upload ??= await client.createUpload(
      companyId,
      {
        unitId,
        kind: media.kind,
        contentType: media.mimeType,
        byteSize: bytes.byteLength,
        sha256: bytesToHex(sha256(bytes)),
        ...(media.durationMs === undefined
          ? {}
          : { durationMs: media.durationMs }),
      },
      retained.createKey,
    );
    if (!retained.putDone) {
      try {
        await client.putObject(retained.upload.upload, bytes);
      } catch {
        throw new ReportError("upload_failed");
      }
      retained.putDone = true;
    }
    retained.completed = await client.completeUpload(
      companyId,
      retained.upload.media.id,
      { expectedVersion: retained.upload.media.version },
      retained.completeKey,
    );
    return retained.completed;
  }
  retained.pending = run().finally(() => {
    retained.pending = undefined;
  });
  return retained.pending;
}
