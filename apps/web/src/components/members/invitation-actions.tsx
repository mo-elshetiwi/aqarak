"use client";
import { useRef, useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { Invitation } from "@/lib/api/contract";
import { invitationLinkSchema } from "@/lib/auth/schemas";
import { postJsonData } from "@/lib/client/post-json";
import { useCsrfToken } from "@/components/shell/session-context";
import { FormField, SubmitButton } from "@/components/auth/form-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { InvitationLinkPanel } from "./invite-sheet";
import { ActionError } from "./member-actions";
export function InvitationCommandForm({
  companyId,
  invitation,
  action,
  onDone,
  onReload,
}: {
  companyId: string;
  invitation: Invitation;
  action: "revoke" | "resend";
  onDone: () => void;
  onReload: () => void;
}): ReactElement {
  const t = useTranslations("Members");
  const locale = useLocale();
  const csrfToken = useCsrfToken();
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<z.infer<
    typeof invitationLinkSchema
  > | null>(null);
  const busy = useRef(false);
  const attempt = useRef({ body: "", key: crypto.randomUUID() });
  const router = useRouter();
  async function submit(): Promise<void> {
    if (busy.current) return;
    if (
      action === "revoke" &&
      (!reason.trim() || reason.trim().length > 2000)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setCode(null);
    setPending(true);
    busy.current = true;
    const input = {
      locale,
      expectedVersion: invitation.version,
      ...(action === "revoke" ? { reason: reason.trim() } : {}),
    };
    const body = JSON.stringify(input);
    if (attempt.current.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    const path = `/api/companies/${companyId}/invitations/${invitation.id}/${action}`;
    const payload = { ...input, idempotencyKey: attempt.current.key };
    const headers = csrfToken ? { csrfToken } : {};
    if (action === "resend") {
      const response = await postJsonData(
        path,
        payload,
        invitationLinkSchema,
        headers,
      );
      if (response.ok) {
        setResult(response.data);
        router.refresh();
      } else setCode(response.code);
    } else {
      const response = await postJsonData(
        path,
        payload,
        z.object({ ok: z.literal(true) }),
        headers,
      );
      if (response.ok) onDone();
      else setCode(response.code);
    }
    setPending(false);
    busy.current = false;
  }
  if (result) return <InvitationLinkPanel result={result} />;
  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action === "revoke" && (
        <FormField
          id="revoke-reason"
          label={t("reason")}
          value={reason}
          maxLength={2000}
          required
          onChange={(event) => {
            setReason(event.target.value);
          }}
          errors={
            invalid
              ? [{ fieldId: "revoke-reason", message: t("reasonRequired") }]
              : []
          }
        />
      )}
      <ActionError code={code} onReload={onReload} />
      <SubmitButton
        pending={pending}
        label={t(code === "UNAVAILABLE" ? "retry" : action)}
      />
    </form>
  );
}
export function InvitationActions({
  companyId,
  invitation,
}: {
  companyId: string;
  invitation: Invitation;
}): ReactElement | null {
  const t = useTranslations("Members");
  const router = useRouter();
  const [action, setAction] = useState<"revoke" | "resend" | null>(null);
  if (!["pending", "expired"].includes(invitation.status)) return null;
  const close = (): void => {
    setAction(null);
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      {invitation.status === "pending" && (
        <Button
          variant="outline"
          onClick={() => {
            setAction("revoke");
          }}
        >
          {t("revoke")}
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => {
          setAction("resend");
        }}
      >
        {t("resend")}
      </Button>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader className="pe-8">
            <DialogTitle>{t(action ?? "resend")}</DialogTitle>
            <DialogDescription>
              {t(
                action === "revoke" ? "revokeDescription" : "resendDescription",
              )}
            </DialogDescription>
          </DialogHeader>
          {action && (
            <InvitationCommandForm
              companyId={companyId}
              invitation={invitation}
              action={action}
              onDone={close}
              onReload={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
