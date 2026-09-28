"use client";
import { useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LockKeyhole } from "lucide-react";
import { ErrorSummary } from "@/components/system/screen-states";
import { FormField, SubmitButton } from "./form-controls";
import { useSubmission } from "./use-submission";
import { validateFields } from "./validation";
export function SignInForm({
  next,
  confirmed = false,
}: {
  next?: string;
  confirmed?: boolean;
}): ReactElement {
  const translate = useTranslations("Auth");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, errors, submit } = useSubmission();
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          path: "/api/auth/sign-in",
          body: {
            email,
            password,
            locale,
            ...(next === undefined ? {} : { next }),
          },
          validation: validateFields({ email, password }, translate),
          fields: ["email", "password"],
          locale,
        });
      }}
    >
      {confirmed && (
        <p
          role="status"
          className="rounded-md border border-status-success-border bg-status-success-bg p-4 text-status-success-fg"
        >
          {translate("confirmed")}
        </p>
      )}
      <ErrorSummary errors={errors} />
      <FormField
        id="email"
        type="email"
        autoComplete="username"
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
        id="password"
        type="password"
        autoComplete="current-password"
        required
        label={translate("password")}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        errors={errors}
      />
      <SubmitButton pending={pending} label={translate("signIn")} />
      <p className="flex items-start gap-2 text-caption text-muted-foreground">
        <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
        {translate("passwordManagers")}
      </p>
    </form>
  );
}
