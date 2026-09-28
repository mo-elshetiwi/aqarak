import { File } from "expo-file-system";
import { getDocumentAsync } from "expo-document-picker";
import {
  emitSessionEvent,
  runSignOutTasks,
} from "@/features/auth/session-events";
import { captureTestFiles } from "@/testing/file-system";
import {
  captureLimits,
  capturedMediaSchema,
  validateCapturedMedia,
  documentMimeType,
} from "./media";
import { CaptureStorage } from "./storage";
import { pickDocument } from "./document";
const mb = 1024 * 1024;
function picked(name: string, mimeType: string, size: number): string {
  const uri = `file:///private-cache/picker/${name}`;
  captureTestFiles.set(uri, size);
  jest.mocked(getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ name, mimeType, size, uri, lastModified: 0 }],
  });
  return uri;
}
async function storage(): Promise<CaptureStorage> {
  const owner = new CaptureStorage();
  await owner.activate("account:company");
  return owner;
}
afterEach(() => {
  jest.restoreAllMocks();
});
it("AC-3 refuses a 21 MB PDF and names the 20 MB limit in both languages", async () => {
  const owner = await storage();
  picked("page.pdf", "application/pdf", 21 * mb);
  const result = await pickDocument(owner);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected refusal");
  expect(result.error.code).toBe("too_large");
  expect(result.error.message.en).toContain("20 MB");
  expect(result.error.message.ar).toContain("20 MB");
  expect(captureTestFiles.size).toBe(0);
});
it("AC-3 refuses docx and lists PDF, JPEG, PNG and HEIC in both languages", async () => {
  const owner = await storage();
  picked(
    "page.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mb,
  );
  const result = await pickDocument(owner);
  if (result.ok) throw new Error("Expected refusal");
  expect(result.error.code).toBe("unsupported_type");
  for (const type of ["PDF", "JPEG", "PNG", "HEIC"]) {
    expect(result.error.message.en).toContain(type);
    expect(result.error.message.ar).toContain(type);
  }
  expect(captureTestFiles.size).toBe(0);
});
it("AC-3 copies a 2 MB PDF into capture and removes the temporary picker copy", async () => {
  const owner = await storage();
  const original = picked("page.PDF", "application/pdf", 2 * mb);
  const result = await pickDocument(owner);
  if (!result.ok) throw new Error("Expected document");
  expect(result.value).toMatchObject({
    kind: "document",
    sizeBytes: 2 * mb,
    mimeType: "application/pdf",
    fileName: "page.PDF",
  });
  expect(result.value.uri).toContain("/capture/");
  expect(capturedMediaSchema.safeParse(result.value).success).toBe(true);
  expect(captureTestFiles.has(original)).toBe(false);
  expect(captureTestFiles.get(result.value.uri)).toBe(2 * mb);
  expect(getDocumentAsync).toHaveBeenCalledWith({
    type: ["application/pdf", "image/jpeg", "image/png", "image/heic"],
    multiple: false,
    copyToCacheDirectory: true,
  });
});
it.each(["signed_out", "context_changed"] as const)(
  "AC-6 %s empties capture and invalidates earlier leases",
  async (type) => {
    const owner = await storage();
    const stop = owner.bind();
    try {
      picked("page.pdf", "application/pdf", 2 * mb);
      await pickDocument(owner);
      expect(captureTestFiles.size).toBe(1);
      await emitSessionEvent({
        type,
        accountId: "account",
        previousCompanyId: "company",
        companyId: "next",
      });
      expect(captureTestFiles.size).toBe(0);
      expect(owner.begin().ok).toBe(false);
    } finally {
      stop();
    }
  },
);
it("AC-6 registered sign-out tasks wipe private files before navigation", async () => {
  const owner = await storage();
  const stop = owner.bind();
  picked("page.pdf", "application/pdf", mb);
  await pickDocument(owner);
  await runSignOutTasks();
  expect(captureTestFiles.size).toBe(0);
  stop();
});
it("a late picker result after a company boundary is cancelled and removed", async () => {
  const owner = await storage();
  const uri = "file:///private-cache/picker/page.pdf";
  let finish:
    ((value: Awaited<ReturnType<typeof getDocumentAsync>>) => void) | undefined;
  jest.mocked(getDocumentAsync).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const result = pickDocument(owner);
  await owner.activate("account:next");
  captureTestFiles.set(uri, mb);
  finish?.({
    canceled: false,
    assets: [
      {
        name: "page.pdf",
        mimeType: "application/pdf",
        uri,
        size: mb,
        lastModified: 0,
      },
    ],
  });
  expect(await result).toMatchObject({
    ok: false,
    error: { code: "cancelled" },
  });
  expect(captureTestFiles.size).toBe(0);
});
it("boundary cleanup waits for a pending copy and removes its late output", async () => {
  const owner = await storage();
  picked("page.pdf", "application/pdf", mb);
  let finish: (() => void) | undefined;
  jest.spyOn(File.prototype, "copy").mockImplementation(
    (destination) =>
      new Promise<void>((resolve) => {
        finish = () => {
          captureTestFiles.set(destination.uri, mb);
          resolve();
        };
      }),
  );
  const lease = owner.begin();
  if (!lease.ok) throw new Error("Expected lease");
  const result = owner.store(
    {
      kind: "document",
      uri: "file:///private-cache/picker/page.pdf",
      mimeType: "application/pdf",
      sizeBytes: mb,
      fileName: "page.pdf",
    },
    lease.value,
  );
  const wipe = owner.activate(null);
  finish?.();
  await wipe;
  expect(await result).toMatchObject({
    ok: false,
    error: { code: "cancelled" },
  });
  expect(captureTestFiles.size).toBe(0);
});
it("actual file size prevents a small picker report from hiding an oversized document", async () => {
  const owner = await storage();
  const uri = picked("page.pdf", "application/pdf", mb);
  captureTestFiles.set(uri, 21 * mb);
  expect(await pickDocument(owner)).toMatchObject({
    ok: false,
    error: { code: "too_large" },
  });
});
it("picker cancellation and native failure are typed and signed-out capture never opens the picker", async () => {
  const owner = new CaptureStorage();
  expect(await pickDocument(owner)).toMatchObject({
    ok: false,
    error: { code: "cancelled" },
  });
  expect(getDocumentAsync).not.toHaveBeenCalled();
  await owner.activate("account:company");
  jest
    .mocked(getDocumentAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  expect(await pickDocument(owner)).toMatchObject({
    ok: false,
    error: { code: "cancelled" },
  });
  jest
    .mocked(getDocumentAsync)
    .mockRejectedValue(new Error("Synthetic native failure"));
  expect(await pickDocument(owner)).toMatchObject({
    ok: false,
    error: { code: "capture_failed" },
  });
});
it("type checks accept lower-cased extensions and reject mismatched MIME types", () => {
  expect(documentMimeType("page.JPEG", "image/jpeg")).toBe("image/jpeg");
  expect(documentMimeType("page.HEIC")).toBe("image/heic");
  expect(documentMimeType("page.png", "application/pdf")).toBeNull();
  expect(documentMimeType("page.docx", "application/pdf")).toBeNull();
});
it.each(
  (
    [
      [
        "voice_note",
        "audio/mp4",
        captureLimits.audioBytes + 1,
        1000,
        "too_large",
        "25 MB",
      ],
      [
        "video",
        "video/mp4",
        captureLimits.videoBytes + 1,
        1000,
        "too_large",
        "100 MB",
      ],
      ["voice_note", "audio/mp4", mb, 300001, "too_long", "5"],
      ["video", "video/mp4", mb, 60001, "too_long", "60"],
    ] as const
  ).map(([kind, mimeType, sizeBytes, durationMs, code, limit]) => ({
    kind,
    mimeType,
    sizeBytes,
    durationMs,
    code,
    limit,
  })),
)(
  "$kind refuses its exceeded limit with a bilingual explanation",
  ({ kind, mimeType, sizeBytes, durationMs, code, limit }) => {
    const result = validateCapturedMedia({
      kind,
      mimeType,
      uri: "file:///private-cache/media",
      sizeBytes,
      durationMs,
    });
    if (result.ok) throw new Error("Expected refusal");
    expect(result.error.code).toBe(code);
    expect(result.error.message.en).toContain(limit);
    expect(result.error.message.ar).toContain(limit);
  },
);
it("retained items can be discarded without deleting original files outside capture", async () => {
  const owner = await storage();
  picked("page.pdf", "application/pdf", mb);
  const result = await pickDocument(owner);
  if (!result.ok) throw new Error("Expected document");
  captureTestFiles.set("file:///documents/original.pdf", mb);
  expect(owner.discard("file:///documents/original.pdf").ok).toBe(false);
  expect(owner.discard(result.value.uri).ok).toBe(true);
  expect(captureTestFiles.has("file:///documents/original.pdf")).toBe(true);
});

it("startup clears private leftovers and discard rejects malformed or escaping paths", async () => {
  const owner = await storage();
  picked("page.pdf", "application/pdf", mb);
  await pickDocument(owner);
  const next = await storage();
  expect(captureTestFiles.size).toBe(0);
  expect(next.discard("invalid").ok).toBe(false);
  expect(next.discard("file:///private-cache/capture/../original.pdf").ok).toBe(
    false,
  );
});
it("a native copy failure removes its temporary and returns a bilingual failure", async () => {
  const owner = await storage();
  picked("page.pdf", "application/pdf", mb);
  jest
    .spyOn(File.prototype, "copy")
    .mockRejectedValue(new Error("Synthetic copy failure"));
  const result = await pickDocument(owner);
  if (result.ok) throw new Error("Expected refusal");
  expect(result.error.code).toBe("capture_failed");
  expect(result.error.message.en.length).toBeGreaterThan(0);
  expect(result.error.message.ar.length).toBeGreaterThan(0);
  expect(captureTestFiles.size).toBe(0);
});
it("duration limits are inclusive and malformed metadata is refused", () => {
  expect(
    validateCapturedMedia({
      kind: "voice_note",
      uri: "file:///private-cache/voice.m4a",
      mimeType: "audio/mp4",
      sizeBytes: captureLimits.audioBytes,
      durationMs: captureLimits.audioDurationMs,
    }).ok,
  ).toBe(true);
  expect(
    validateCapturedMedia({
      kind: "video",
      uri: "file:///private-cache/video.mp4",
      mimeType: "video/mp4",
      sizeBytes: captureLimits.videoBytes,
      durationMs: captureLimits.videoDurationMs,
    }).ok,
  ).toBe(true);
  expect(
    validateCapturedMedia({
      kind: "photo",
      uri: "file:///private-cache/photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1.5,
    }).ok,
  ).toBe(false);
  expect(documentMimeType("pdf", "application/pdf")).toBeNull();
});
