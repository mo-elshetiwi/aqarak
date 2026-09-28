import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { documentId, documentVersionId } from "../ids";
import { localDate } from "../time";
import {
  documentProcessingStatus,
  documentReviewStatus,
  type DocumentType,
} from "../vocabulary";
import {
  checkExtractionPages,
  checkUploadContent,
  checkUploadRequest,
  deriveDocumentValidity,
  documentsErrorCode,
  isEmiratesIdNumber,
  isScanClean,
  missingOnboardingDocuments,
  onboardingDocumentRequirements,
  processingTransitions,
  reviewTransitions,
  sniffContentType,
  transitionDocumentProcessing,
  transitionDocumentReview,
  uploadLimits,
  type DocumentVersionSnapshot,
  type OnboardingPartyKind,
  type ProcessingCommand,
  type ReviewCommand,
  type UploadContentType,
} from "./index";

const version: DocumentVersionSnapshot = {
  id: documentVersionId.parse("00000000-0000-4000-8000-000000000001"),
  documentId: documentId.parse("00000000-0000-4000-8000-000000000002"),
  versionNumber: 1,
  documentType: "emirates_id",
  expiryDate: localDate.parse("2026-12-31"),
  processing_status: "awaiting_upload",
  review_status: "pending_review",
  recordedSha256: "a".repeat(64),
  recordedByteSize: 20,
};
const acceptedNewer: DocumentVersionSnapshot = {
  ...version,
  id: documentVersionId.parse("00000000-0000-4000-8000-000000000003"),
  versionNumber: 2,
  processing_status: "extracted",
  review_status: "accepted",
};
const accept: ReviewCommand = {
  type: "accept",
  documentType: "passport",
  expiryDate: null,
  typeConfirmed: true,
  datesConfirmed: true,
};
function processingCommand(
  type: ProcessingCommand["type"],
  outcome: boolean | null,
): ProcessingCommand {
  switch (type) {
    case "bytes_arrived":
      return {
        type,
        sha256: version.recordedSha256,
        byteSize: outcome === true ? version.recordedByteSize : 21,
      };
    case "scan_result":
      return { type, clean: outcome === true };
    case "start_extraction":
    case "extraction_succeeded":
    case "extraction_failed":
    case "retry_extraction":
      return { type };
  }
}
function reviewCommand(type: ReviewCommand["type"]): ReviewCommand {
  switch (type) {
    case "accept":
      return accept;
    case "reject":
      return { type, reason: "wrong_type" };
    case "supersede":
      return { type, newerVersion: acceptedNewer };
  }
}

describe("independent document facets", () => {
  it.each(processingTransitions)(
    "processing $from / $command / $outcome / $to",
    (row) => {
      const state = { ...version, processing_status: row.from };
      const result = transitionDocumentProcessing(
        state,
        processingCommand(row.command, row.outcome),
        "pipeline",
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          version: {
            processing_status: row.to,
            review_status: "pending_review",
          },
          no_op: false,
        },
      });
      expect(state.processing_status).toBe(row.from);
    },
  );
  it.each(processingTransitions)(
    "refuses processing $command from the wrong state",
    (row) => {
      const wrong =
        row.command === "bytes_arrived" ? "uploaded" : "awaiting_upload";
      expect(
        transitionDocumentProcessing(
          { ...version, processing_status: wrong },
          processingCommand(row.command, row.outcome),
          "pipeline",
        ),
      ).toEqual({ ok: false, error: { code: "INVALID_TRANSITION" } });
    },
  );
  it.each(
    documentProcessingStatus.options.filter(
      (status) => status !== "awaiting_upload" && status !== "uploaded",
    ),
  )("AC-6 marks scan results in %s as no_op", (processing_status) => {
    const state = { ...version, processing_status };
    for (const clean of [true, false]) {
      expect(
        transitionDocumentProcessing(
          state,
          { type: "scan_result", clean },
          "pipeline",
        ),
      ).toEqual({
        ok: true,
        value: { version: state, no_op: true, reason: null },
      });
    }
  });
  it.each(documentReviewStatus.options)(
    "AC-6 malware preserves human review %s",
    (review_status) => {
      expect(
        transitionDocumentProcessing(
          { ...version, processing_status: "uploaded", review_status },
          { type: "scan_result", clean: false },
          "pipeline",
        ),
      ).toMatchObject({
        ok: true,
        value: {
          version: { processing_status: "scan_rejected", review_status },
        },
      });
    },
  );
  it.each([
    { sha256: "b".repeat(64), byteSize: 20 },
    { sha256: "invalid", byteSize: 20 },
    { sha256: "a".repeat(64), byteSize: 21 },
    { sha256: "a".repeat(64), byteSize: 0 },
    { sha256: "a".repeat(64), byteSize: 1.5 },
  ])("rejects upload integrity mismatch $sha256 / $byteSize", (observed) => {
    expect(
      transitionDocumentProcessing(
        version,
        { type: "bytes_arrived", ...observed },
        "pipeline",
      ),
    ).toMatchObject({
      ok: true,
      value: {
        version: {
          processing_status: "scan_rejected",
          review_status: "pending_review",
        },
      },
    });
  });
  it.each(["person", "scheduler", "co_worker"] as const)(
    "refuses processing writes by %s",
    (actor) => {
      expect(
        transitionDocumentProcessing(
          version,
          processingCommand("bytes_arrived", true),
          actor,
        ),
      ).toEqual({ ok: false, error: { code: "NOT_A_PIPELINE_COMMAND" } });
    },
  );
  it.each(reviewTransitions)("review $from / $command / $to", (row) => {
    const state = {
      ...version,
      processing_status: "scan_clean",
      review_status: row.from,
    } as const;
    expect(
      transitionDocumentReview(state, reviewCommand(row.command), "person"),
    ).toMatchObject({
      ok: true,
      value: {
        version: { review_status: row.to, processing_status: "scan_clean" },
        no_op: false,
      },
    });
    expect(
      transitionDocumentReview(
        { ...state, review_status: "superseded" },
        reviewCommand(row.command),
        "person",
      ),
    ).toEqual({ ok: false, error: { code: "INVALID_TRANSITION" } });
  });
  it.each(documentProcessingStatus.options)(
    "AC-6 requires a clean scan for review acceptance from %s",
    (processing_status) => {
      const clean = [
        "scan_clean",
        "extracting",
        "extracted",
        "extraction_failed",
      ].includes(processing_status);
      expect(isScanClean(processing_status)).toBe(clean);
      const result = transitionDocumentReview(
        { ...version, processing_status },
        accept,
        "person",
      );
      if (clean)
        expect(result).toMatchObject({
          ok: true,
          value: {
            version: {
              documentType: "passport",
              expiryDate: null,
              review_status: "accepted",
            },
          },
        });
      else
        expect(result).toEqual({
          ok: false,
          error: { code: "SCAN_NOT_CLEAN" },
        });
    },
  );
  it.each(["pipeline", "scheduler", "co_worker"] as const)(
    "AC-6 refuses %s review commands under IN7",
    (actor) => {
      expect(
        transitionDocumentReview(
          { ...version, processing_status: "extracted" },
          accept,
          actor,
        ),
      ).toEqual({ ok: false, error: { code: "NOT_A_PERSON_COMMAND" } });
    },
  );
  it.each([
    { typeConfirmed: false, datesConfirmed: true },
    { typeConfirmed: true, datesConfirmed: false },
  ])("requires both type and date confirmation", (confirmation) => {
    expect(
      transitionDocumentReview(
        { ...version, processing_status: "scan_clean" },
        { ...accept, ...confirmation },
        "person",
      ),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "confirmed_fields" },
    });
  });
  it("requires a rejection reason and accepts illegibility", () => {
    expect(
      transitionDocumentReview(
        version,
        { type: "reject", reason: null },
        "person",
      ),
    ).toEqual({
      ok: false,
      error: { code: "REASON_REQUIRED", field: "reason" },
    });
    expect(
      transitionDocumentReview(
        version,
        { type: "reject", reason: "illegible" },
        "person",
      ),
    ).toMatchObject({ ok: true, value: { reason: "illegible" } });
  });
  const invalidNewer: readonly Partial<DocumentVersionSnapshot>[] = [
    { documentId: documentId.parse("00000000-0000-4000-8000-000000000009") },
    { id: version.id },
    { versionNumber: 1 },
    { review_status: "pending_review" },
    { processing_status: "scan_rejected" },
  ];
  it.each(invalidNewer)(
    "requires a distinct newer accepted clean version of the same document: %s",
    (patch) => {
      expect(
        transitionDocumentReview(
          { ...version, review_status: "accepted" },
          { type: "supersede", newerVersion: { ...acceptedNewer, ...patch } },
          "person",
        ),
      ).toEqual({
        ok: false,
        error: { code: "INVALID_INPUT", field: "newer_version" },
      });
    },
  );
  it("keeps both facet transition sequences independent and pure", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...documentProcessingStatus.options),
        fc.constantFrom(...documentReviewStatus.options),
        fc.array(
          fc.constantFrom(
            ...processingTransitions.map((row) =>
              processingCommand(row.command, row.outcome),
            ),
          ),
          { maxLength: 60 },
        ),
        (processing_status, review_status, commands) => {
          let state = { ...version, processing_status, review_status };
          for (const command of commands) {
            const result = transitionDocumentProcessing(
              state,
              command,
              "pipeline",
            );
            if (result.ok) {
              expect(result.value.version.review_status).toBe(review_status);
              state = result.value.version;
            } else
              expect(
                documentsErrorCode.safeParse(result.error.code).success,
              ).toBe(true);
          }
        },
      ),
      { seed: 2060928, numRuns: 100 },
    );
  }, 60_000);
});

describe("upload verification", () => {
  const headers: readonly {
    readonly type: UploadContentType;
    readonly bytes: readonly number[];
  }[] = [
    { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
    {
      type: "image/png",
      bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    },
    { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
    {
      type: "video/mp4",
      bytes: [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
    },
    {
      type: "audio/mp4",
      bytes: [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20],
    },
    { type: "audio/mpeg", bytes: [0x49, 0x44, 0x33] },
    { type: "audio/mpeg", bytes: [0xff, 0xfb, 0x90, 0] },
    {
      type: "audio/wav",
      bytes: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
    },
  ];
  it.each(headers)(
    "AC-7 sniffs and matches $type from synthetic magic bytes",
    ({ type, bytes }) => {
      const head = new Uint8Array(bytes);
      expect(sniffContentType(head)).toBe(type);
      expect(checkUploadContent({ contentType: type, head })).toEqual({
        ok: true,
        value: undefined,
      });
    },
  );
  it.each(Object.entries(uploadLimits))(
    "AC-7 applies the exact %s byte limit",
    (contentType, limit) => {
      expect(checkUploadRequest({ contentType, byteSize: limit })).toEqual({
        ok: true,
        value: undefined,
      });
      expect(checkUploadRequest({ contentType, byteSize: limit + 1 })).toEqual({
        ok: false,
        error: {
          code: "UPLOAD_TOO_LARGE",
          field: `max_bytes:${String(limit)}`,
        },
      });
    },
  );
  it("AC-7 checks PDF binary megabytes and refuses a PNG declared as PDF", () => {
    expect(uploadLimits["application/pdf"]).toBe(20_971_520);
    expect(
      checkUploadContent({
        contentType: "application/pdf",
        head: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
    ).toEqual({
      ok: false,
      error: { code: "CONTENT_TYPE_MISMATCH", field: "content_type" },
    });
    expect(
      checkUploadContent({
        contentType: "application/pdf",
        head: new Uint8Array([1, 2, 3]),
      }),
    ).toMatchObject({ ok: false, error: { code: "CONTENT_TYPE_MISMATCH" } });
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid declared size %s",
    (byteSize) => {
      expect(
        checkUploadRequest({ contentType: "application/pdf", byteSize }),
      ).toEqual({
        ok: false,
        error: { code: "INVALID_INPUT", field: "byte_size" },
      });
    },
  );
  it("refuses unsupported declarations", () => {
    expect(
      checkUploadRequest({
        contentType: "application/octet-stream",
        byteSize: 1,
      }),
    ).toEqual({
      ok: false,
      error: { code: "UNSUPPORTED_TYPE", field: "content_type" },
    });
    expect(
      checkUploadContent({
        contentType: "application/octet-stream",
        head: new Uint8Array(),
      }),
    ).toEqual({
      ok: false,
      error: { code: "UNSUPPORTED_TYPE", field: "content_type" },
    });
  });
  it.each([
    { bytes: [] },
    { bytes: [1, 2, 3, 4] },
    { bytes: [0xff] },
    { bytes: [0xff, 0] },
    { bytes: [0x52, 0x49, 0x46, 0x46] },
    { bytes: [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70] },
  ])("AC-7 unknown or truncated bytes return null: $bytes", ({ bytes }) => {
    expect(sniffContentType(new Uint8Array(bytes))).toBeNull();
  });
  it("AC-7 random bytes without a supported signature remain unknown", () => {
    fc.assert(
      fc.property(
        fc
          .uint8Array({ minLength: 0, maxLength: 100 })
          .filter(
            (head) =>
              ![0x25, 0x89, 0xff, 0x49, 0x52].includes(head[0] ?? -1) &&
              head[4] !== 0x66,
          ),
        (head) => {
          expect(sniffContentType(head)).toBeNull();
        },
      ),
      { seed: 2060928, numRuns: 100 },
    );
  }, 60_000);
  it.each([1, 20])("accepts extraction of %s pages", (pages) => {
    expect(checkExtractionPages(pages)).toEqual({ ok: true, value: undefined });
  });
  it.each([0, -1, 0.5, NaN, Infinity])(
    "refuses invalid extraction page count %s",
    (pages) => {
      expect(checkExtractionPages(pages)).toMatchObject({
        ok: false,
        error: { code: "INVALID_INPUT" },
      });
    },
  );
  it("refuses extraction above twenty pages", () => {
    expect(checkExtractionPages(21)).toEqual({
      ok: false,
      error: { code: "TOO_MANY_PAGES", field: "max_pages:20" },
    });
  });
});

describe("validity and onboarding", () => {
  it.each([
    ["2026-09-19", "2026-09-30", 10, "valid"],
    ["2026-09-20", "2026-09-30", 10, "expiring_soon"],
    ["2026-09-30", "2026-09-30", 10, "expiring_soon"],
    ["2026-10-01", "2026-09-30", 10, "expired"],
    ["2026-10-01", null, 10, "valid"],
    ["2028-02-28", "2028-03-01", 2, "expiring_soon"],
    ["2026-09-30", "2026-09-30", 0, "expiring_soon"],
  ] as const)(
    "AC-8 validity on %s with expiry %s and lead %s",
    (on, expiryDate, leadDays, expected) => {
      expect(
        deriveDocumentValidity({
          on: localDate.parse(on),
          expiryDate: expiryDate === null ? null : localDate.parse(expiryDate),
          leadDays,
        }),
      ).toBe(expected);
    },
  );
  it.each([-1, 0.5, NaN, Infinity])(
    "rejects invalid reminder lead %s",
    (leadDays) => {
      expect(() =>
        deriveDocumentValidity({
          expiryDate: null,
          on: localDate.parse("2026-09-28"),
          leadDays,
        }),
      ).toThrow(RangeError);
    },
  );
  const on = localDate.parse("2026-09-28");
  function document(documentType: DocumentType): DocumentVersionSnapshot {
    return {
      ...version,
      documentType,
      review_status: "accepted",
      expiryDate: null,
    };
  }
  const parties: readonly OnboardingPartyKind[] = [
    "owner",
    "individual_tenant",
    "company_tenant",
  ];
  it.each(parties)("AC-8 returns all missing requirements for %s", (party) => {
    expect(missingOnboardingDocuments(party, [], on)).toEqual(
      onboardingDocumentRequirements[party],
    );
  });
  it.each(["title_deed", "site_plan"] as const)(
    "AC-8 accepts owner onboarding with %s",
    (title) => {
      const types: readonly DocumentType[] = [
        "emirates_id",
        title,
        "management_agreement",
        "tawtheeq_authorisation",
      ];
      const versions = types.map(document);
      expect(missingOnboardingDocuments("owner", versions, on)).toEqual([]);
    },
  );
  it("AC-8 requires an individual tenant's ID while passport is optional", () => {
    expect(
      missingOnboardingDocuments(
        "individual_tenant",
        [document("emirates_id")],
        on,
      ),
    ).toEqual([]);
    expect(
      missingOnboardingDocuments(
        "individual_tenant",
        [document("passport")],
        on,
      ),
    ).toEqual([["emirates_id"]]);
  });
  it("AC-8 requires company trade licence and signatory identity", () => {
    expect(
      missingOnboardingDocuments(
        "company_tenant",
        [document("trade_licence"), document("signatory_id")],
        on,
      ),
    ).toEqual([]);
    expect(
      missingOnboardingDocuments(
        "company_tenant",
        [document("trade_licence")],
        on,
      ),
    ).toEqual([["signatory_id"]]);
  });
  it.each(documentReviewStatus.options)(
    "counts only accepted, unexpired versions from %s",
    (review_status) => {
      expect(
        missingOnboardingDocuments(
          "individual_tenant",
          [{ ...document("emirates_id"), review_status }],
          on,
        ),
      ).toEqual(review_status === "accepted" ? [] : [["emirates_id"]]);
    },
  );
  it("keeps expiry-day documents and ignores expired versions", () => {
    expect(
      missingOnboardingDocuments(
        "individual_tenant",
        [{ ...document("emirates_id"), expiryDate: on }],
        on,
      ),
    ).toEqual([]);
    expect(
      missingOnboardingDocuments(
        "individual_tenant",
        [
          {
            ...document("emirates_id"),
            expiryDate: localDate.parse("2026-09-27"),
          },
        ],
        on,
      ),
    ).toEqual([["emirates_id"]]);
  });
  it.each([
    ["000000000000000", true],
    ["00000000000000", false],
    ["0000000000000000", false],
    ["00000000000000a", false],
    [" 000000000000000", false],
    ["٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠", false],
  ])("AC-8 checks only fifteen digits: %s", (value, expected) => {
    expect(isEmiratesIdNumber(value)).toBe(expected);
  });
});
