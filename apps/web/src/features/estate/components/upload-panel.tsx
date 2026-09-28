"use client";
import {
  useState,
  type ChangeEvent,
  type ReactElement,
  type SubmitEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusTag } from "@/components/system/status-tag";
import {
  acceptInputSchema,
  ownerDocTypeSchema,
  ownerUploadSchema,
  propertyUploadSchema,
  rejectInputSchema,
  type ActionContext,
  type DocumentItem,
  type DocumentTarget,
  type EstateActionResult,
  type UploadInput,
  type UploadResponse,
  type VersionItem,
} from "../contract";
import {
  requestOwnerUploadAction,
  requestPropertyUploadAction,
  checkOwnerDocumentAction,
  checkPropertyDocumentAction,
  acceptOwnerDocumentAction,
  acceptPropertyDocumentAction,
  rejectOwnerDocumentAction,
  rejectPropertyDocumentAction,
} from "../actions";
import {
  controlClass,
  Field,
  fieldAccessibility,
  FormFeedback,
  useActionContext,
  useEstateForm,
} from "./shared";
import { DocumentProcessing } from "./document-processing";
interface UploadPanelProps {
  companyId: string;
  recordId: string;
  entity: DocumentTarget["entity"];
  docType: UploadInput["docType"];
  document?: DocumentItem | undefined;
  onClose: () => void;
}
const newKey = () => crypto.randomUUID().replaceAll("-", "");
async function requestUpload(
  context: ActionContext,
  input: UploadInput,
  target: Pick<DocumentTarget, "entity" | "recordId">,
): Promise<EstateActionResult<UploadResponse>> {
  if (target.entity === "owners") {
    const parsed = ownerUploadSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "DOC_TYPE_NOT_ALLOWED" };
    return requestOwnerUploadAction(context, parsed.data, [target.recordId]);
  }
  const parsed = propertyUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "DOC_TYPE_NOT_ALLOWED" };
  return requestPropertyUploadAction(context, parsed.data, [target.recordId]);
}
function checkUpload(context: ActionContext, target: DocumentTarget) {
  const action =
    target.entity === "owners"
      ? checkOwnerDocumentAction
      : checkPropertyDocumentAction;
  return action(context, {}, [
    target.recordId,
    target.documentId,
    target.versionId,
  ]);
}
function checkFile(file: File): "UNSUPPORTED_TYPE" | "UPLOAD_TOO_LARGE" | null {
  if (
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type) ||
    !/\.(pdf|jpe?g|png)$/i.test(file.name)
  )
    return "UNSUPPORTED_TYPE";
  return file.size > 20 * 1024 * 1024 || file.size === 0
    ? "UPLOAD_TOO_LARGE"
    : null;
}
export function UploadPanel(props: UploadPanelProps): ReactElement {
  const t = useTranslations(
    props.entity === "owners" ? "Owners" : "Properties",
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl motion-reduce:transition-none">
        <DialogTitle>{t(`documents.${props.docType}`)}</DialogTitle>
        <DialogDescription>{t("uploadHelp")}</DialogDescription>
        <UploadContent {...props} />
      </DialogContent>
    </Dialog>
  );
}
export function UploadContent({
  companyId,
  recordId,
  entity,
  docType,
  document,
}: UploadPanelProps): ReactElement {
  const namespace = entity === "owners" ? "Owners" : "Properties";
  const t = useTranslations(namespace);
  const router = useRouter();
  const form = useEstateForm(namespace, "upload-submit");
  const context = useActionContext(companyId, form.key);
  const [file, setFile] = useState<File | null>(null);
  const [storedVersion, setVersion] = useState<VersionItem | null>(
    () => document?.latest ?? null,
  );
  const version = latestVersion(storedVersion, document?.latest);
  const [target, setTarget] = useState<DocumentTarget | null>(() =>
    document?.latest
      ? {
          entity,
          recordId,
          documentId: document.documentId,
          versionId: document.latest.versionId,
        }
      : null,
  );
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "checking" | "ready"
  >(() =>
    document?.latest?.processingStatus === "uploaded" ? "checking" : "idle",
  );
  const [checkKey, setCheckKey] = useState(newKey);
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    const problem = checkFile(chosen);
    if (problem) {
      setFile(null);
      form.failure(problem, "document-file");
      return;
    }
    form.setErrors([]);
    setFile(chosen);
  }
  async function upload(): Promise<EstateActionResult<VersionItem>> {
    try {
      return await performUpload();
    } catch {
      setPhase("idle");
      return { ok: false, code: "UNAVAILABLE", field: "document-file" };
    }
  }
  async function performUpload(): Promise<EstateActionResult<VersionItem>> {
    if (!file)
      return { ok: false, code: "VALIDATION_FAILED", field: "document-file" };
    setPhase("uploading");
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const parsed = (
      entity === "owners" ? ownerUploadSchema : propertyUploadSchema
    ).safeParse({
      docType,
      contentType: file.type,
      byteSize: file.size,
      sha256,
    });
    if (!parsed.success)
      return { ok: false, code: "VALIDATION_FAILED", field: "document-file" };
    const response = await requestUpload(context, parsed.data, {
      entity,
      recordId,
    });
    if (!response.ok) {
      setPhase("idle");
      return response;
    }
    const destination = response.data;
    const uploaded = await fetch(destination.upload.url, {
      method: destination.upload.method,
      headers: destination.upload.headers,
      body: bytes,
    });
    if (!uploaded.ok) {
      setPhase("idle");
      return { ok: false, code: "UNAVAILABLE", field: "document-file" };
    }
    const nextTarget: DocumentTarget = {
      entity,
      recordId,
      documentId: destination.documentId,
      versionId: destination.documentVersionId,
    };
    setTarget(nextTarget);
    setPhase("checking");
    const checked = await checkUpload(
      { ...context, idempotencyKey: checkKey },
      nextTarget,
    );
    if (!checked.ok) return checked;
    setCheckKey(newKey());
    setPhase(checkPhase(checked.data));
    return { ok: true, data: checked.data.version };
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    form.submit(upload, (next) => {
      element.reset();
      setFile(null);
      setVersion(next);
      router.refresh();
    });
  }
  function checkAgain() {
    if (!target) return;
    form.submit(
      () => checkUpload({ ...context, idempotencyKey: checkKey }, target),
      (result) => {
        setVersion(result.version);
        setPhase(checkPhase(result));
        setCheckKey(newKey());
        router.refresh();
      },
    );
  }
  return (
    <div className="space-y-5">
      <FormFeedback form={form} />
      <div aria-live="polite">
        {phase !== "idle" && t(phase)}
        {version && (
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusTag entity="document_version" state={version.reviewStatus} />
            <DocumentProcessing
              version={version}
              namespace={namespace}
              scanPending={phase === "checking"}
            />
            <span>{t("version", { number: version.versionNo })}</span>
            {version.rejectReason && (
              <p>{t("rejected", { reason: version.rejectReason })}</p>
            )}
          </div>
        )}
      </div>
      <form noValidate onSubmit={submit} className="space-y-4">
        <Field id="document-file" label={t("chooseFile")} errors={form.errors}>
          <input
            id="document-file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={choose}
            disabled={form.pending}
            className="block w-full text-body"
            {...fieldAccessibility("document-file", form.errors)}
          />
        </Field>
        <Button
          id="upload-submit"
          type="submit"
          variant={version ? "secondary" : "default"}
          disabled={form.pending || !file}
        >
          {t(form.pending ? "uploading" : "upload")}
        </Button>
      </form>
      {target && canCheck(version) && (
        <Button
          type="button"
          variant="secondary"
          disabled={form.pending}
          onClick={checkAgain}
        >
          {t("check")}
        </Button>
      )}
      {target && version && (
        <VersionReview
          companyId={companyId}
          target={target}
          docType={docType}
          version={version}
          onVersion={(next) => {
            setVersion(next);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
export function VersionReview({
  companyId,
  target,
  docType,
  version,
  onVersion,
}: {
  companyId: string;
  target: DocumentTarget;
  docType: UploadInput["docType"];
  version: VersionItem;
  onVersion: (version: VersionItem) => void;
}): ReactElement {
  const namespace = target.entity === "owners" ? "Owners" : "Properties";
  const t = useTranslations(namespace);
  const form = useEstateForm(namespace, "review-submit");
  const context = useActionContext(companyId, form.key);
  const expiryRequired = ownerDocTypeSchema.safeParse(docType).success;
  const [saved, setSaved] = useState(false);
  function complete(result: { version: VersionItem }) {
    setSaved(true);
    onVersion(result.version);
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ids = [target.recordId, target.documentId, target.versionId];
    const button = event.nativeEvent.submitter;
    if (button instanceof HTMLButtonElement && button.value === "reject") {
      const parsed = rejectInputSchema.safeParse({
        expectedVersion: version.version,
        reason: data.get("reason"),
      });
      if (!parsed.success) {
        form.failure("VALIDATION_FAILED", "reason");
        return;
      }
      const action =
        target.entity === "owners"
          ? rejectOwnerDocumentAction
          : rejectPropertyDocumentAction;
      form.submit(() => action(context, parsed.data, ids), complete);
      return;
    }
    if (expiryRequired && !data.get("expiryDate")) {
      form.failure("EXPIRY_REQUIRED", "expiryDate");
      return;
    }
    const parsed = acceptInputSchema.safeParse({
      expectedVersion: version.version,
      ...(data.get("issueDate") ? { issueDate: data.get("issueDate") } : {}),
      ...(data.get("expiryDate") ? { expiryDate: data.get("expiryDate") } : {}),
    });
    if (!parsed.success) {
      form.failure("VALIDATION_FAILED", "expiryDate");
      return;
    }
    if (
      parsed.data.issueDate &&
      parsed.data.expiryDate &&
      parsed.data.expiryDate < parsed.data.issueDate
    ) {
      form.failure("EXPIRY_BEFORE_ISSUE", "expiryDate");
      return;
    }
    const action =
      target.entity === "owners"
        ? acceptOwnerDocumentAction
        : acceptPropertyDocumentAction;
    form.submit(() => action(context, parsed.data, ids), complete);
  }
  if (
    version.processingStatus !== "scan_clean" ||
    version.reviewStatus !== "pending_review"
  )
    return <p aria-live="polite">{saved && t("reviewSaved")}</p>;
  return (
    <form noValidate onSubmit={submit} className="space-y-4 border-t pt-4">
      <FormFeedback form={form} />
      <p>{t("fileFactsUnavailable")}</p>
      <dl className="grid grid-cols-2 gap-3">
        {(["fileType", "fileSize", "uploadedAt"] as const).map((field) => (
          <div key={field} className="contents">
            <dt>{t(field)}</dt>
            <dd>{t("notProvided")}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["issueDate", "expiryDate"] as const).map((id) => (
          <Field key={id} id={id} label={t(id)} errors={form.errors}>
            <input
              id={id}
              name={id}
              type="date"
              dir="ltr"
              required={id === "expiryDate" && expiryRequired}
              defaultValue={version[id] ?? ""}
              className={controlClass}
              {...fieldAccessibility(id, form.errors)}
            />
          </Field>
        ))}
      </div>
      <Field id="reason" label={t("rejectReason")} errors={form.errors}>
        <textarea
          id="reason"
          name="reason"
          maxLength={500}
          className={`${controlClass} min-h-20`}
          {...fieldAccessibility("reason", form.errors)}
        />
      </Field>
      <div className="flex gap-3">
        <Button
          id="review-submit"
          type="submit"
          name="decision"
          value="accept"
          disabled={form.pending}
        >
          {t(form.pending ? "saving" : "accept")}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="secondary"
          disabled={form.pending}
        >
          {t("reject")}
        </Button>
      </div>
    </form>
  );
}

function checkPhase(result: {
  version: VersionItem;
  scanPending: boolean;
}): "ready" | "checking" | "idle" {
  if (result.scanPending) return "checking";
  return result.version.processingStatus === "scan_clean" ? "ready" : "idle";
}
function latestVersion(
  stored: VersionItem | null,
  latest?: VersionItem | null,
): VersionItem | null {
  if (!latest || !stored) return stored;
  if (latest.versionId === stored.versionId && latest.version > stored.version)
    return latest;
  return stored;
}

function canCheck(version: VersionItem | null): boolean {
  return (
    version?.processingStatus === "awaiting_upload" ||
    version?.processingStatus === "uploaded"
  );
}
