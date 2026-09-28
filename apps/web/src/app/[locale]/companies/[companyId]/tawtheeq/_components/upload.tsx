"use client";
import { useRef, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { describeUpload, putCertificate, validateFile } from "../_lib/upload";
import type { TawtheeqRecord } from "../_lib/schemas";
import { ActionError, controlClass } from "./common";
import { useMutation, type RunAction } from "./use-mutation";
import { useUploadCompletion } from "./use-upload-completion";
export function UploadPanel({
  record,
  run,
}: {
  record: TawtheeqRecord;
  run: RunAction;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [file, setFile] = useState<File | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "checksum" | "uploading" | "completing"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState(false);
  const fileErrorRef = useRef<HTMLParagraphElement>(null);
  const { error, setError, submit } = useMutation(run);
  const active = useRef(false);
  const completion = useUploadCompletion({
    submit,
    expectedVersion: record.version,
    setError,
    rejectFile: () => {
      setRejected(true);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    },
  });
  async function upload(): Promise<void> {
    if (!file || active.current) return;
    active.current = true;
    setError(null);
    try {
      if (completion.documentId) {
        setStage("completing");
        await completion.complete(completion.documentId, record.version);
        return;
      }
      setStage("checksum");
      const input = await describeUpload(file);
      const requested = await submit(
        { command: "requestUpload", input },
        requestKey,
      );
      if (!requested.ok || !requested.upload) return;
      setStage("uploading");
      await putCertificate(file, requested.upload.upload, setProgress);
      setStage("completing");
      await completion.complete(
        requested.upload.documentVersionId,
        requested.record.version,
      );
    } catch (cause) {
      setError({
        ok: false,
        code: cause instanceof Error ? cause.message : "UPLOAD_FAILED",
        fieldErrors: {},
      });
    } finally {
      setStage("idle");
      active.current = false;
    }
  }
  return (
    <section
      className="space-y-4 rounded-lg border bg-card p-6"
      aria-labelledby="upload-title"
    >
      <h2 id="upload-title" className="text-h2">
        {t(
          rejected || record.document?.reviewStatus === "rejected"
            ? "replaceUpload"
            : "upload",
        )}
      </h2>
      <p id="upload-help">{t("uploadHelp")}</p>
      <label htmlFor="certificate-file" className="block">
        {t("uploadLabel")}
      </label>
      <input
        ref={inputRef}
        id="certificate-file"
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className={controlClass}
        disabled={stage !== "idle"}
        aria-describedby="upload-help"
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null;
          const invalid = Boolean(selected && !validateFile(selected));
          setFileError(invalid);
          setFile(invalid ? null : selected);
          setError(null);
          completion.reset();
          setRequestKey(crypto.randomUUID());
          if (invalid)
            requestAnimationFrame(() => fileErrorRef.current?.focus());
        }}
      />
      {fileError && (
        <p
          ref={fileErrorRef}
          tabIndex={-1}
          role="alert"
          className="text-status-danger-fg"
        >
          {t("fileInvalid")}
        </p>
      )}
      <p role="status" aria-live="polite">
        {completion.scanning
          ? t("scanInProgress")
          : stage === "idle"
            ? ""
            : stage === "uploading"
              ? t("uploading", { progress })
              : t(stage)}
      </p>
      {stage === "uploading" && (
        <progress
          aria-label={t("upload")}
          max={100}
          value={progress}
          className="w-full accent-primary"
        />
      )}
      <ActionError error={error} />
      <Button
        disabled={!file || stage !== "idle"}
        onClick={() => {
          void upload();
        }}
      >
        {t(
          completion.documentId
            ? "checkAgain"
            : rejected || record.document?.reviewStatus === "rejected"
              ? "replaceUpload"
              : "upload",
        )}
      </Button>
    </section>
  );
}
