"use client";
import { useRef, useState, useTransition, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ErrorSummary,
  FieldError,
  type FormError,
} from "@/components/system/screen-states";
import { createTenantAction } from "../_lib/actions";
import {
  createFields,
  parseCreateTenant,
  type CreateTenantValues,
} from "../_lib/create-tenant";
export function CreateTenantForm({
  route,
}: {
  route: { locale: string; companyId: string };
}): ReactElement {
  const t = useTranslations("Tenants");
  const documents = useTranslations("Documents");
  const [values, setValues] = useState<CreateTenantValues>({
    fullNameEn: "",
    fullNameAr: "",
    email: "",
    phoneE164: "",
    preferredLanguage: "en",
  });
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function submit(): void {
    if (busy.current) return;
    const parsed = parseCreateTenant(values);
    if (!parsed.success) {
      setErrors(
        createFields
          .filter((field) =>
            parsed.error.issues.some((issue) => issue.path[0] === field),
          )
          .map((field) => ({
            fieldId: field,
            message: t(`create.errors.${field}`),
          })),
      );
      return;
    }
    busy.current = true;
    setErrors([]);
    startTransition(async () => {
      try {
        const result = await createTenantAction({
          ...route,
          key: crypto.randomUUID(),
          values,
        });
        setValues(result.values);
        const invalid = createFields.filter(
          (field) => result.field === field || result.fields?.includes(field),
        );
        setErrors(
          invalid.length
            ? invalid.map((field) => ({
                fieldId: field,
                message: t(`create.errors.${field}`),
              }))
            : [
                {
                  fieldId: "create-tenant",
                  message: documents(`errors.${result.code}`),
                },
              ],
        );
      } finally {
        busy.current = false;
      }
    });
  }
  return (
    <form
      id="create-tenant"
      tabIndex={-1}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="max-w-2xl space-y-6"
      aria-busy={pending}
    >
      <p>{t("create.individual")}</p>
      <p id="identity-help" className="text-muted-foreground">
        {t("create.helper")}
      </p>
      <ErrorSummary errors={errors} />
      <fieldset disabled={pending} className="space-y-5">
        {(["fullNameEn", "fullNameAr", "email", "phoneE164"] as const).map(
          (field) => {
            const error = errors.find((item) => item.fieldId === field);
            return (
              <div key={field} className="space-y-2">
                <Label htmlFor={field}>{t(`create.${field}`)}</Label>
                <Input
                  id={field}
                  name={field}
                  dir={field === "fullNameAr" ? "rtl" : "ltr"}
                  type={
                    field === "email"
                      ? "email"
                      : field === "phoneE164"
                        ? "tel"
                        : "text"
                  }
                  value={values[field]}
                  required={field === "fullNameEn" || field === "email"}
                  maxLength={
                    field === "email" ? 320 : field === "phoneE164" ? 16 : 120
                  }
                  autoComplete={
                    field === "email"
                      ? "email"
                      : field === "phoneE164"
                        ? "tel"
                        : "name"
                  }
                  aria-invalid={Boolean(error)}
                  aria-describedby={[
                    "identity-help",
                    field === "phoneE164" ? "phone-help" : "",
                    error ? `${field}-error` : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onChange={(event) => {
                    setValues({ ...values, [field]: event.target.value });
                  }}
                />
                {field === "phoneE164" && (
                  <p
                    id="phone-help"
                    className="text-caption text-muted-foreground"
                  >
                    {t("create.phoneHint")}
                  </p>
                )}
                {error && (
                  <FieldError id={`${field}-error`} message={error.message} />
                )}
              </div>
            );
          },
        )}
        <fieldset
          id="preferredLanguage"
          tabIndex={-1}
          className="space-y-2"
          aria-describedby={
            errors.some((error) => error.fieldId === "preferredLanguage")
              ? "language-error"
              : undefined
          }
        >
          <legend className="text-body-strong">
            {t("create.preferredLanguage")}
          </legend>
          {(["en", "ar"] as const).map((language) => (
            <label key={language} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="preferredLanguage"
                value={language}
                checked={values.preferredLanguage === language}
                required
                onChange={() => {
                  setValues({ ...values, preferredLanguage: language });
                }}
              />
              {t(language)}
            </label>
          ))}
          {errors
            .filter((error) => error.fieldId === "preferredLanguage")
            .map((error) => (
              <FieldError
                key={error.fieldId}
                id="language-error"
                message={error.message}
              />
            ))}
        </fieldset>
        <Button type="submit" disabled={pending}>
          {t(pending ? "create.saving" : "add")}
        </Button>
      </fieldset>
    </form>
  );
}
