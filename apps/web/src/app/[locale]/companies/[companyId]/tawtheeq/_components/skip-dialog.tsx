"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { TawtheeqRecord } from "../_lib/schemas";
import { ActionError, controlClass } from "./common";
import { useMutation, type RunAction } from "./use-mutation";
export function SkipDialog({
  record,
  run,
}: {
  record: TawtheeqRecord;
  run: RunAction;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { busy, error, setError, submit } = useMutation(run);
  async function skip(): Promise<void> {
    if (!reason.trim()) {
      setError({
        ok: false,
        code: "VALIDATION_FAILED",
        fieldErrors: { "input.reason": ["REASON_REQUIRED"] },
      });
      return;
    }
    const result = await submit(
      {
        command: "skip",
        input: {
          expectedVersion: record.version,
          reason,
          requestOwnerConfirmation: record.contract.frozenOwnerGate,
        },
      },
      key,
    );
    if (result.ok) setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            disabled={
              Boolean(record.skipReason) && record.contract.frozenOwnerGate
            }
          />
        }
      >
        {t("skip")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl motion-reduce:transition-none">
        <DialogTitle>{t("skipTitle")}</DialogTitle>
        <DialogDescription>{t("skipWarning")}</DialogDescription>
        {record.contract.frozenOwnerGate && <p>{t("skipGate")}</p>}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void skip();
          }}
          className="space-y-4"
        >
          <ActionError error={error} />
          <label className="block" htmlFor="skip-reason">
            {t("reason")}
          </label>
          <textarea
            id="skip-reason"
            required
            aria-required="true"
            aria-invalid={Boolean(error?.fieldErrors["input.reason"])}
            className={controlClass}
            maxLength={2000}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setKey(crypto.randomUUID());
            }}
          />
          <div className="flex flex-wrap justify-end gap-3">
            <DialogClose render={<Button variant="secondary" type="button" />}>
              {t("cancel")}
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {t(
                record.contract.frozenOwnerGate
                  ? "requestSkipConfirmation"
                  : "skipConfirm",
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
