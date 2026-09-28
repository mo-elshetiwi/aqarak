"use client";
import { useRef, useState, useTransition, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ErrorSummary,
  FieldError,
  type FormError,
} from "@/components/system/screen-states";
import { rejectUploadAction } from "../_lib/actions";
import type { RejectInput } from "../_lib/j3-contract";
import type { ReviewRoute } from "../_lib/routes";
export function RejectUploadDialog({
  route,
  disabled = false,
}: {
  route: ReviewRoute;
  disabled?: boolean;
}): ReactElement {
  const t = useTranslations("Documents");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RejectInput["reason"]>("wrong_type");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function confirm(): void {
    if (busy.current) return;
    if (note.length > 500) {
      setErrors([
        { fieldId: "reject-note", message: t("rejectUpload.noteError") },
      ]);
      return;
    }
    busy.current = true;
    setErrors([]);
    startTransition(async () => {
      try {
        const result = await rejectUploadAction({
          ...route,
          key: crypto.randomUUID(),
          rejection: { reason, ...(note.trim() ? { note: note.trim() } : {}) },
        });
        if (!result.ok)
          setErrors([
            { fieldId: "reject-reason", message: t(`errors.${result.code}`) },
          ]);
      } finally {
        busy.current = false;
      }
    });
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("rejectUpload.title")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogTitle>{t("rejectUpload.title")}</DialogTitle>
          <DialogDescription>{t("rejectUpload.consequence")}</DialogDescription>
          <form
            className="space-y-4"
            noValidate
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            <ErrorSummary errors={errors} />
            <fieldset
              id="reject-reason"
              tabIndex={-1}
              disabled={pending}
              className="space-y-2"
            >
              <legend className="text-body-strong">
                {t("rejectUpload.reason")}
              </legend>
              {(["wrong_type", "illegible", "other"] as const).map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="reason"
                    value={value}
                    checked={reason === value}
                    onChange={() => {
                      setReason(value);
                    }}
                  />
                  {t(`rejectUpload.reasons.${value}`)}
                </label>
              ))}
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="reject-note">{t("rejectUpload.note")}</Label>
              <textarea
                id="reject-note"
                dir="auto"
                className="min-h-24 w-full rounded-md border border-input bg-transparent p-3"
                value={note}
                maxLength={500}
                disabled={pending}
                aria-describedby="reject-note-help"
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
              <p
                id="reject-note-help"
                className="text-caption text-muted-foreground"
              >
                {t("rejectUpload.noteHint")}
              </p>
            </div>
            {errors.map((error) => (
              <FieldError
                key={error.fieldId}
                id={`${error.fieldId}-error`}
                message={error.message}
              />
            ))}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="outline" disabled={pending}>
                {t(pending ? "rejectUpload.pending" : "rejectUpload.confirm")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
