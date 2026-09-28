"use client";
import { useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { ErrorSummary } from "@/components/system/screen-states";
import { Button } from "@/components/ui/button";
import { FormField, SubmitButton } from "./form-controls";
import { useSubmission } from "./use-submission";
import { validateFields } from "./validation";
export function VerifyForm({
  pendingEmail,
}: {
  pendingEmail: string;
}): ReactElement {
  const translate = useTranslations("Auth");
  const locale = useLocale();
  const [email, setEmail] = useState(pendingEmail);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const { pending, errors, submit } = useSubmission();
  const [resending, setResending] = useState(false);
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setResending(false);
        setSent(false);
        void submit({
          path: "/api/auth/confirm-sign-up",
          body: { email, code, locale },
          validation: validateFields({ email, code }, translate),
          fields: ["email", "code"],
          locale,
          confirmed: true,
        });
      }}
    >
      <ErrorSummary errors={errors} />
      <FormField
        id="email"
        type="email"
        autoComplete="email"
        required
        label={translate("email")}
        hint={translate("emailHint")}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
        errors={errors}
      />
      <FormField
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={6}
        label={translate("code")}
        hint={translate("codeHint")}
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
        }}
        errors={errors}
      />
      <SubmitButton pending={pending} label={translate("verify")} />
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={pending}
        onClick={() => {
          setResending(true);
          setSent(false);
          void submit({
            path: "/api/auth/resend-code",
            body: { email, locale },
            validation: validateFields({ email }, translate),
            fields: ["email"],
            locale,
            onSuccess: () => {
              setSent(true);
            },
          });
        }}
      >
        {pending && resending && (
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {translate("resend")}
      </Button>
      <p role="status" aria-live="polite" className="text-body">
        {sent ? translate("codeSent") : ""}
      </p>
    </form>
  );
}
