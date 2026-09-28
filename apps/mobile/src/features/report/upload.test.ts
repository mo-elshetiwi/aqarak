import type { CapturedMedia } from "@/features/capture/media";
import { createHttpReportClient } from "./http-client";
import { uploadCapturedMedia } from "./upload";
import {
  jsonResponse,
  syntheticId,
  syntheticMedia,
  syntheticUpload,
} from "./test-support";
const bytes = new Uint8Array([97, 98, 99]);
const capture: CapturedMedia = {
  kind: "voice_note",
  uri: "file:///private-cache/capture/synthetic.m4a",
  mimeType: "audio/mp4",
  sizeBytes: 3,
  durationMs: 12000,
};
function fake(): jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>> {
  return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
}
it("AC-2 hashes private bytes and uses plain PUT with signed headers, no length or bearer token", async () => {
  const upload = syntheticUpload();
  const auth = fake()
    .mockResolvedValueOnce(jsonResponse(upload, 201))
    .mockResolvedValueOnce(jsonResponse({ media: syntheticMedia() }));
  const plain = fake().mockResolvedValue(new Response(null, { status: 200 }));
  const client = createHttpReportClient(
    "https://api.example.test",
    auth,
    plain,
  );
  const read = jest.fn(() => Promise.resolve(bytes));
  expect(
    await uploadCapturedMedia(
      client,
      syntheticId(80),
      syntheticId(1),
      capture,
      read,
    ),
  ).toEqual(syntheticMedia());
  expect(read).toHaveBeenCalledWith(capture.uri);
  expect(JSON.parse(auth.mock.calls[0]?.[1]?.body as string)).toMatchObject({
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    byteSize: 3,
    durationMs: 12000,
  });
  const put = plain.mock.calls[0];
  expect(put?.[0]).toBe(upload.upload.url);
  expect(new Uint8Array(put?.[1]?.body as ArrayBuffer)).toEqual(bytes);
  const headers = new Headers(put?.[1]?.headers);
  expect(headers.get("content-length")).toBeNull();
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("x-amz-checksum-sha256")).toBe(
    upload.upload.headers["x-amz-checksum-sha256"],
  );
  expect(JSON.parse(auth.mock.calls[1]?.[1]?.body as string)).toEqual({
    expectedVersion: 1,
  });
});
it("AC-2 preserves capture and resumes a failed PUT without another createUpload", async () => {
  const auth = fake()
    .mockResolvedValueOnce(jsonResponse(syntheticUpload(), 201))
    .mockResolvedValueOnce(jsonResponse({ media: syntheticMedia() }));
  const plain = fake()
    .mockRejectedValueOnce(new TypeError("Synthetic offline"))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  const client = createHttpReportClient(
    "https://api.example.test",
    auth,
    plain,
  );
  const retained = { ...capture };
  await expect(
    uploadCapturedMedia(client, syntheticId(80), syntheticId(1), capture, () =>
      Promise.resolve(bytes),
    ),
  ).rejects.toMatchObject({ code: "upload_failed" });
  expect(capture).toEqual(retained);
  await uploadCapturedMedia(
    client,
    syntheticId(80),
    syntheticId(1),
    capture,
    () => Promise.resolve(bytes),
  );
  expect(
    auth.mock.calls.filter(([url]) =>
      (typeof url === "string"
        ? url
        : url instanceof URL
          ? url.href
          : url.url
      ).endsWith("/uploads"),
    ),
  ).toHaveLength(1);
  expect(plain).toHaveBeenCalledTimes(2);
});
it("AC-2 retries a timed-out completion with the same key and never repeats PUT", async () => {
  const auth = fake()
    .mockResolvedValueOnce(jsonResponse(syntheticUpload(), 201))
    .mockRejectedValueOnce(new TypeError("Synthetic timeout"))
    .mockResolvedValueOnce(jsonResponse({ media: syntheticMedia() }));
  const plain = fake().mockResolvedValue(new Response(null, { status: 200 }));
  const client = createHttpReportClient(
    "https://api.example.test",
    auth,
    plain,
  );
  await expect(
    uploadCapturedMedia(client, syntheticId(80), syntheticId(1), capture, () =>
      Promise.resolve(bytes),
    ),
  ).rejects.toMatchObject({ code: "network_unavailable" });
  await uploadCapturedMedia(
    client,
    syntheticId(80),
    syntheticId(1),
    capture,
    () => Promise.resolve(bytes),
  );
  expect(plain).toHaveBeenCalledTimes(1);
  expect(
    new Headers(auth.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
  ).toBe(new Headers(auth.mock.calls[2]?.[1]?.headers).get("Idempotency-Key"));
});
it("AC-2 retries a lost createUpload response with the same key and filters injected authorization", async () => {
  const upload = syntheticUpload();
  upload.upload.headers.Authorization = "Bearer synthetic";
  const auth = fake()
    .mockRejectedValueOnce(new TypeError("Synthetic timeout"))
    .mockResolvedValueOnce(jsonResponse(upload, 201))
    .mockResolvedValueOnce(jsonResponse({ media: syntheticMedia() }));
  const plain = fake().mockResolvedValue(new Response(null, { status: 200 }));
  const client = createHttpReportClient(
    "https://api.example.test",
    auth,
    plain,
  );
  await expect(
    uploadCapturedMedia(client, syntheticId(80), syntheticId(1), capture, () =>
      Promise.resolve(bytes),
    ),
  ).rejects.toMatchObject({ code: "network_unavailable" });
  await uploadCapturedMedia(
    client,
    syntheticId(80),
    syntheticId(1),
    capture,
    () => Promise.resolve(bytes),
  );
  expect(
    new Headers(auth.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  ).toBe(new Headers(auth.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"));
  expect(
    new Headers(plain.mock.calls[0]?.[1]?.headers).get("authorization"),
  ).toBeNull();
});
