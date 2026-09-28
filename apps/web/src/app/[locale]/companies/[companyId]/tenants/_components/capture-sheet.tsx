"use client";
import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSummary, FieldError } from "@/components/system/screen-states";
import {
  requestUploadAction,
  completeUploadAction,
  startExtractionAction,
} from "../_lib/actions";
import {
  captureIdentity,
  captureSteps,
  newCaptureAttempt,
  sha256,
  type CaptureAttempt,
  type CaptureStep,
  type CaptureResult,
} from "../_lib/capture-flow";
import { reviewPath, type TenantRoute } from "../_lib/routes";
export function CaptureSheet({
  route,
  uploadAgain,
}: {
  route: TenantRoute;
  uploadAgain?: boolean;
}): ReactElement {
  const t = useTranslations("Documents");
  const tenants = useTranslations("Tenants");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<CaptureStep | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const attempt = useRef<CaptureAttempt | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const error = captureError(result, t);
  const rejected = isRejected(result);
  async function start(): Promise<void> {
    if (!file || busy.current) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    attempt.current ??= newCaptureAttempt();
    const outcome = await captureIdentity(file, route, attempt.current, {
      request: requestUploadAction,
      complete: completeUploadAction,
      extract: startExtractionAction,
      put: (url, options) => fetch(url, options),
      digest: sha256,
      delay: () =>
        new Promise((resolve) => {
          setTimeout(resolve, 3000);
        }),
      step: setStep,
    });
    setResult(outcome);
    setPending(false);
    busy.current = false;
    if (outcome.ok && !outcome.storedPdf)
      router.push(reviewPath(outcome.route));
  }
  function reset(): void {
    setFile(null);
    setStep(null);
    setResult(null);
    attempt.current = null;
    if (input.current) input.current.value = "";
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        {tenants(uploadAgain ? "uploadAgain" : "upload")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy.current) setOpen(value);
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-auto sm:max-w-2xl"
          showCloseButton={!pending}
        >
          <DialogTitle>{t("captureTitle")}</DialogTitle>
          <DialogDescription>{t("nothingSaved")}</DialogDescription>
          <p className="text-body-strong">
            {t("documentType")}: {t("emiratesFront")}
          </p>
          {error && (
            <ErrorSummary
              errors={[{ fieldId: "identity-file", message: error }]}
            />
          )}
          <div className="space-y-2">
            <Label htmlFor="identity-file">{t("chooseFile")}</Label>
            <Input
              ref={input}
              id="identity-file"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              disabled={pending}
              aria-describedby="file-formats"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                setStep(null);
                setResult(null);
                attempt.current = null;
              }}
            />
            <p id="file-formats" className="text-caption text-muted-foreground">
              {t("formats")}
            </p>
            {file && (
              <p>
                <bdi>{file.name}</bdi>
              </p>
            )}
            {error && <FieldError id="file-error" message={error} />}
            {rejected?.reason && (
              <p role="status">
                <bdi>{rejected.reason}</bdi>
              </p>
            )}
          </div>
          <div className="rounded-md border bg-muted p-4 text-caption space-y-2">
            <p>{t("good")}</p>
            <p>{t("rejected")}</p>
          </div>
          {step && (
            <>
              <p role="status" aria-live="polite">
                {t(`steps.${step}`)}
              </p>
              <ol className="space-y-2">
                {captureSteps.map((name, index) => (
                  <li key={name} className="flex justify-between gap-4">
                    <span>{t(`steps.${name}`)}</span>
                    <span>
                      {t(
                        `stepState.${index < captureSteps.indexOf(step) || step === "ready" ? "done" : name === step ? "active" : "waiting"}`,
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {result?.ok && result.storedPdf && (
            <p role="status">{t("pdfStored")}</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              {t("cancel")}
            </Button>
            {result && (
              <Button variant="outline" disabled={pending} onClick={reset}>
                {t("newUpload")}
              </Button>
            )}
            <Button
              disabled={!file || pending || isRejected(result) !== null}
              onClick={() => {
                void start();
              }}
            >
              {error ? t("retry") : t("start")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function captureError(
  result: CaptureResult | null,
  t: ReturnType<typeof useTranslations<"Documents">>,
): string | null {
  return result && !result.ok ? t(`errors.${result.code}`) : null;
}
function isRejected(
  result: CaptureResult | null,
): (CaptureResult & { ok: false }) | null {
  return result && !result.ok && result.code === "SCAN_REJECTED"
    ? result
    : null;
}
