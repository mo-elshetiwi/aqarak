"use client";
import { useState, type ReactElement, type SubmitEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateText } from "@/components/system/formatted-values";
import { StatusTag } from "@/components/system/status-tag";
import { invitationInputSchema, type OwnerDetail } from "../contract";
import { inviteOwnerAction } from "../actions";
import {
  controlClass,
  Field,
  fieldAccessibility,
  FormFeedback,
  useActionContext,
  useEstateForm,
} from "./shared";

export function OwnerInvitation({
  owner,
  companyId,
  manager,
}: {
  owner: OwnerDetail;
  companyId: string;
  manager: boolean;
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const [open, setOpen] = useState(false);
  const [recorded, setRecorded] = useState<OwnerDetail["invitation"]>(null);
  const invitation = recorded ?? owner.invitation;
  return (
    <div className="space-y-3">
      <div aria-live="polite" className="space-y-2">
        {recorded && <p>{t("invited")}</p>}
        {invitation && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag entity="invitation" state={invitation.status} />
            <span>{t("invitationExpires")}</span>
            <DateText iso={invitation.expiresAt} locale={locale} />
          </div>
        )}
      </div>
      {manager && !owner.linked && (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t("invite")}
        </Button>
      )}
      {open && (
        <InvitationDialog
          owner={owner}
          companyId={companyId}
          onClose={() => {
            setOpen(false);
          }}
          onRecorded={(value) => {
            setRecorded(value);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function InvitationDialog({
  owner,
  companyId,
  onClose,
  onRecorded,
}: {
  owner: OwnerDetail;
  companyId: string;
  onClose: () => void;
  onRecorded: (invitation: NonNullable<OwnerDetail["invitation"]>) => void;
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const router = useRouter();
  const form = useEstateForm("Owners", "invitation-submit");
  const context = useActionContext(companyId, form.key);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = invitationInputSchema.safeParse({
      email: data.get("email"),
    });
    if (!parsed.success) {
      form.failure("OWNER_EMAIL_REQUIRED", "email");
      return;
    }
    form.submit(
      () => inviteOwnerAction(context, parsed.data, [owner.id]),
      (result) => {
        onRecorded(result.invitation);
        router.refresh();
      },
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !form.pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>{t("invite")}</DialogTitle>
        <DialogDescription>
          {t("inviteCheck", { name: owner.fullName[locale] })}
        </DialogDescription>
        <form noValidate onSubmit={submit} className="space-y-5">
          <FormFeedback form={form} />
          <Field id="email" label={t("email")} errors={form.errors}>
            <input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              defaultValue={owner.email ?? ""}
              readOnly={Boolean(owner.email)}
              className={controlClass}
              {...fieldAccessibility("email", form.errors)}
            />
          </Field>
          <Button id="invitation-submit" type="submit" disabled={form.pending}>
            {t(form.pending ? "saving" : "sendInvitation")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
