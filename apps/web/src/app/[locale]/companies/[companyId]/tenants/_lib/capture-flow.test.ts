import { describe, expect, it, vi } from "vitest";
import {
  captureIdentity,
  newCaptureAttempt,
  sha256,
  type CaptureDependencies,
} from "./capture-flow";
import { seedVersion } from "./j3-mock";
const version = seedVersion();
const route = {
  locale: "en",
  companyId: "10000000-0000-4000-8000-000000000001",
  tenantId: "tenant-1",
};
const file = new File(["synthetic-image"], "sample.jpg", {
  type: "image/jpeg",
});
function dependencies() {
  return {
    request: vi.fn<CaptureDependencies["request"]>().mockResolvedValue({
      ok: true,
      document: { id: version.documentId, docType: "emirates_id" },
      version,
      upload: {
        method: "PUT",
        url: "https://storage.example.test/upload",
        headers: {
          "Content-Type": "image/jpeg",
          "x-amz-checksum-sha256": "bound-checksum",
        },
        expiresAt: "2026-09-28T06:00:00Z",
      },
    }),
    complete: vi
      .fn<CaptureDependencies["complete"]>()
      .mockResolvedValue({ ok: true, version }),
    extract: vi
      .fn<CaptureDependencies["extract"]>()
      .mockResolvedValue({ ok: true, version }),
    put: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 })),
    digest: vi
      .fn<CaptureDependencies["digest"]>()
      .mockResolvedValue("a".repeat(64)),
    delay: vi.fn<CaptureDependencies["delay"]>().mockResolvedValue(undefined),
    step: vi.fn<CaptureDependencies["step"]>(),
  };
}
describe("W-5 capture pipeline", () => {
  it("hashes, uploads with exactly returned headers and advances named steps", async () => {
    const deps = dependencies();
    const result = await captureIdentity(
      file,
      route,
      newCaptureAttempt(),
      deps,
    );
    expect(result).toEqual({
      ok: true,
      route: {
        ...route,
        documentId: version.documentId,
        versionId: version.id,
      },
      manual: false,
      storedPdf: false,
    });
    expect(deps.step.mock.calls.map(([step]) => step)).toEqual([
      "uploading",
      "checking",
      "scanning",
      "reading",
      "ready",
    ]);
    expect(deps.request.mock.calls[0]?.[0].upload).toMatchObject({
      sha256: "a".repeat(64),
      byteSize: file.size,
      subjectId: "tenant-1",
      uploadedVia: "web",
    });
    expect(deps.put).toHaveBeenCalledWith(
      "https://storage.example.test/upload",
      {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
          "x-amz-checksum-sha256": "bound-checksum",
        },
        body: file,
        redirect: "error",
      },
    );
  });
  it("retries scan pending with the same key and opens failed extraction in manual mode", async () => {
    const deps = dependencies();
    deps.extract
      .mockResolvedValueOnce({ ok: false, code: "SCAN_PENDING" })
      .mockResolvedValueOnce({ ok: false, code: "SCAN_PENDING" })
      .mockResolvedValue({
        ok: true,
        version: {
          ...version,
          fields: null,
          processingStatus: "extraction_failed",
        },
      });
    const result = await captureIdentity(
      file,
      route,
      newCaptureAttempt(),
      deps,
    );
    expect(result).toMatchObject({ ok: true, manual: true });
    expect(deps.delay).toHaveBeenCalledTimes(2);
    expect(
      new Set(deps.extract.mock.calls.map(([args]) => args.key)).size,
    ).toBe(1);
  });
  it("stops after forty retries and resumes the same upload without another PUT", async () => {
    const deps = dependencies();
    const attempt = newCaptureAttempt();
    deps.extract.mockResolvedValue({ ok: false, code: "SCAN_PENDING" });
    expect(await captureIdentity(file, route, attempt, deps)).toEqual({
      ok: false,
      code: "SCAN_PENDING",
    });
    expect(deps.extract).toHaveBeenCalledTimes(41);
    expect(deps.delay).toHaveBeenCalledTimes(40);
    deps.extract.mockResolvedValue({ ok: true, version });
    expect(await captureIdentity(file, route, attempt, deps)).toMatchObject({
      ok: true,
    });
    expect(deps.request).toHaveBeenCalledOnce();
    expect(deps.put).toHaveBeenCalledOnce();
  });
  it("shows the rejection reason and never extracts a rejected file", async () => {
    const deps = dependencies();
    deps.complete.mockResolvedValue({
      ok: true,
      version: {
        ...version,
        processingStatus: "scan_rejected",
        rejectReason: "checksum_mismatch",
      },
    });
    expect(
      await captureIdentity(file, route, newCaptureAttempt(), deps),
    ).toEqual({
      ok: false,
      code: "SCAN_REJECTED",
      reason: "checksum_mismatch",
    });
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it("stores PDFs without automatic extraction and rejects unsupported files", async () => {
    const deps = dependencies();
    expect(
      await captureIdentity(
        new File(["pdf"], "sample.pdf", { type: "application/pdf" }),
        route,
        newCaptureAttempt(),
        deps,
      ),
    ).toMatchObject({ ok: true, storedPdf: true });
    expect(deps.extract).not.toHaveBeenCalled();
    deps.request.mockClear();
    expect(
      await captureIdentity(
        new File(["svg"], "sample.svg", { type: "image/svg+xml" }),
        route,
        newCaptureAttempt(),
        deps,
      ),
    ).toEqual({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(deps.request).not.toHaveBeenCalled();
  });
  it("computes the real SHA-256 locally", async () => {
    expect(await sha256(new File(["abc"], "sample.jpg"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

it("waits for an in-progress extraction replay before declaring the document ready", async () => {
  const deps = dependencies();
  deps.extract
    .mockResolvedValueOnce({
      ok: true,
      version: { ...version, processingStatus: "extracting", fields: null },
    })
    .mockResolvedValue({ ok: true, version });
  const result = await captureIdentity(file, route, newCaptureAttempt(), deps);
  expect(result).toMatchObject({ ok: true, manual: false });
  expect(deps.delay).toHaveBeenCalledOnce();
  expect(deps.extract).toHaveBeenCalledTimes(2);
  expect(deps.step).toHaveBeenLastCalledWith("ready");
});
