import {
  uploadInputSchema,
  type UploadInput,
  type UploadResult,
} from "./schemas";
export function validateFile(
  file: Pick<File, "name" | "type" | "size">,
): boolean {
  return uploadInputSchema.safeParse({
    fileName: file.name,
    contentType: file.type,
    byteSize: file.size,
    sha256: "0".repeat(64),
  }).success;
}
export async function describeUpload(file: File): Promise<UploadInput> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return uploadInputSchema.parse({
    fileName: file.name,
    contentType: file.type,
    byteSize: file.size,
    sha256,
  });
}
export function putCertificate(
  file: File,
  target: UploadResult["upload"],
  progress: (value: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    xhr.timeout = 120_000;
    for (const [name, value] of Object.entries(target.headers)) {
      // I leave Content-Length to the browser, which computes it from these exact file bytes.
      if (name.toLowerCase() !== "content-length")
        xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(
          new Error(
            xhr.status === 400
              ? "CHECKSUM_MISMATCH"
              : xhr.status === 403
                ? "UPLOAD_EXPIRED"
                : "UPLOAD_FAILED",
          ),
        );
    };
    xhr.onerror = xhr.ontimeout = () => {
      reject(new Error("UPLOAD_FAILED"));
    };
    xhr.send(file);
  });
}
