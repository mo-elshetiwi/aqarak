"use client";
import { useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorSummary } from "@/components/system/screen-states";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { FormField, SubmitButton } from "./form-controls";
import { useSubmission } from "./use-submission";
import { validateFields, validatePassword } from "./validation";
export function SignUpForm(): ReactElement {
  const translate = useTranslations("Auth");
  const currentLocale = useLocale();
  const [locale, setLocale] = useState(currentLocale);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { pending, errors, code, submit } = useSubmission();
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          path: "/api/auth/sign-up",
          body: { fullName, email, password, locale },
          validation: [
            ...validateFields({ fullName, email }, translate),
            ...validatePassword(password, translate("PASSWORD_POLICY")),
          ],
          fields: ["fullName", "email", "password"],
          locale,
        });
      }}
    >
      <ErrorSummary errors={errors} />
      {code === "EMAIL_TAKEN" && (
        <Link
          href="/sign-in"
          className="inline-flex min-h-6 text-brand underline"
        >
          {translate("signIn")}
        </Link>
      )}
      <FormField
        id="fullName"
        autoComplete="name"
        required
        maxLength={120}
        label={translate("fullName")}
        hint={translate("nameHint")}
        value={fullName}
        onChange={(event) => {
          setFullName(event.target.value);
        }}
        errors={errors}
      />
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
        id="password"
        type="password"
        autoComplete="new-password"
        required
        maxLength={256}
        label={translate("password")}
        hint={translate("passwordPolicy")}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        errors={errors}
      />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">{translate("language")}</legend>
        <RadioGroup
          value={locale}
          onValueChange={(value: unknown) => {
            if (value === "en" || value === "ar") setLocale(value);
          }}
          aria-label={translate("language")}
          className="flex flex-wrap gap-4"
        >
          <Label lang="en">
            <RadioGroupItem value="en" />
            {translate("english")}
          </Label>
          <Label lang="ar">
            <RadioGroupItem value="ar" />
            {translate("arabic")}
          </Label>
        </RadioGroup>
      </fieldset>
      <SubmitButton pending={pending} label={translate("signUp")} />
    </form>
  );
}
