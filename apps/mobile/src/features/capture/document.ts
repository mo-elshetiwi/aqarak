import * as DocumentPicker from "expo-document-picker";
import { err, type Result } from "@aqarak/domain";
import {
  captureError,
  documentMimeType,
  type CapturedMedia,
  type CaptureError,
} from "./media";
import type { CaptureStorage } from "./storage";

/** Picker copies are moved into private ownership; late results after a context change are discarded. */
export async function pickDocument(
  storage: CaptureStorage,
): Promise<Result<CapturedMedia, CaptureError>> {
  const lease = storage.begin();
  if (!lease.ok) return lease;
  let temporaryUri: string | undefined;
  try {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/heic"],
      multiple: false,
      copyToCacheDirectory: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return err(captureError("cancelled"));
    temporaryUri = asset.uri;
    const mimeType = documentMimeType(asset.name, asset.mimeType);
    if (!mimeType) {
      storage.removeTemporary(asset.uri);
      return err(captureError("unsupported_type"));
    }
    return await storage.store(
      {
        kind: "document",
        uri: asset.uri,
        mimeType,
        sizeBytes: asset.size ?? 0,
        fileName: asset.name,
      },
      lease.value,
    );
  } catch {
    if (temporaryUri) {
      try {
        storage.removeTemporary(temporaryUri);
      } catch {
        /* No native exception or file metadata crosses the result boundary. */
      }
    }
    return err(captureError("capture_failed"));
  }
}
