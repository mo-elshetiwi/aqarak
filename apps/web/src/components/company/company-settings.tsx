"use client";
import { useRef, useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { domainLabel, type Locale } from "@aqarak/i18n";
import type { Company } from "@/lib/api/contract";
import { companyNameSchema } from "@/lib/api/contract";
import { postJsonData } from "@/lib/client/post-json";
import { useCsrfToken } from "@/components/shell/session-context";
import { FormField, SubmitButton } from "@/components/auth/form-controls";
import {
  ErrorState,
  ErrorSummary,
  OfflineBanner,
  type FormError,
} from "@/components/system/screen-states";
import { Button } from "@/components/ui/button";
export function CompanySettingsForm({
  company,
}: {
  company: Company;
}): ReactElement {
  const t = useTranslations("Company");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const csrfToken = useCsrfToken();
  const [nameEn, setNameEn] = useState(company.name.en);
  const [nameAr, setNameAr] = useState(company.name.ar);
  const [licence, setLicence] = useState(company.tradeLicenceNumber ?? "");
  const [trn, setTrn] = useState(company.trn ?? "");
  const [version, setVersion] = useState(company.version);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const attempt = useRef({ body: "", key: crypto.randomUUID() });
  async function submit(): Promise<void> {
    if (busy.current) return;
    const invalid: FormError[] = [];
    if (!companyNameSchema.shape.en.safeParse(nameEn).success)
      invalid.push({ fieldId: "company-name-en", message: t("invalidName") });
    if (!companyNameSchema.shape.ar.safeParse(nameAr).success)
      invalid.push({ fieldId: "company-name-ar", message: t("invalidName") });
    if (
      (company.kind === "management_company" && !licence.trim()) ||
      licence.trim().length > 40
    )
      invalid.push({
        fieldId: "company-licence",
        message: t("invalidLicence"),
      });
    if (trn.trim() && !/^\d{15}$/.test(trn.trim()))
      invalid.push({ fieldId: "company-trn", message: t("invalidTrn") });
    setErrors(invalid);
    setSaved(false);
    setCode(null);
    if (invalid.length) return;
    busy.current = true;
    setPending(true);
    const input = {
      locale,
      expectedVersion: version,
      name: { en: nameEn.trim(), ar: nameAr.trim() },
      tradeLicenceNumber: licence.trim() || null,
      trn: trn.trim() || null,
    };
    const body = JSON.stringify(input);
    if (attempt.current.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    const response = await postJsonData(
      `/api/companies/${company.id}`,
      { ...input, idempotencyKey: attempt.current.key },
      z.object({ ok: z.literal(true) }),
      csrfToken ? { csrfToken } : {},
    );
    setPending(false);
    busy.current = false;
    if (response.ok) {
      setSaved(true);
      setVersion(version + 1);
      router.refresh();
    } else setCode(response.code);
  }
  function reload(): void {
    setNameEn(company.name.en);
    setNameAr(company.name.ar);
    setLicence(company.tradeLicenceNumber ?? "");
    setTrn(company.trn ?? "");
    setVersion(company.version);
    setCode(null);
    router.refresh();
    window.location.reload();
  }
  const refusal =
    (
      [
        "VERSION_CONFLICT",
        "FORBIDDEN",
        "VALIDATION_FAILED",
        "SESSION_INVALID",
      ] as const
    ).find((item) => item === code) ?? "UNAVAILABLE";
  return (
    <form
      className="max-w-2xl space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ErrorSummary errors={errors} />
      <dl className="space-y-4">
        <div>
          <dt className="text-label">{t("kind")}</dt>
          <dd>{domainLabel(locale, "companyKind", company.kind)}</dd>
        </div>
        <div>
          <dt className="text-label">{t("ownerApproval")}</dt>
          <dd>{t("on")}</dd>
          <dd className="mt-2 text-muted-foreground">
            {t("ownerApprovalDescription")}
          </dd>
        </div>
      </dl>
      <FormField
        id="company-name-en"
        label={t("nameEn")}
        dir="ltr"
        required
        value={nameEn}
        onChange={(event) => {
          setNameEn(event.target.value);
        }}
        errors={errors}
      />
      <FormField
        id="company-name-ar"
        label={t("nameAr")}
        dir="rtl"
        required
        value={nameAr}
        onChange={(event) => {
          setNameAr(event.target.value);
        }}
        errors={errors}
      />
      <FormField
        id="company-licence"
        label={t("licence")}
        dir="ltr"
        required={company.kind === "management_company"}
        value={licence}
        onChange={(event) => {
          setLicence(event.target.value);
        }}
        errors={errors}
      />
      <FormField
        id="company-trn"
        label={t("trn")}
        dir="ltr"
        inputMode="numeric"
        value={trn}
        onChange={(event) => {
          setTrn(event.target.value);
        }}
        errors={errors}
      />
      {code && (
        <div
          role="alert"
          className="space-y-3 rounded-md border border-status-danger-border bg-status-danger-bg p-4 text-status-danger-fg"
        >
          <p>{t(refusal)}</p>
          {code === "VERSION_CONFLICT" && (
            <Button type="button" variant="outline" onClick={reload}>
              {t("reload")}
            </Button>
          )}
        </div>
      )}
      {saved && <p role="status">{t("saved")}</p>}
      <SubmitButton pending={pending} label={t("save")} />
    </form>
  );
}
export function CompanySettings({
  company,
}: {
  company: Company | null;
}): ReactElement {
  const t = useTranslations("Company");
  const router = useRouter();
  return (
    <div className="space-y-6">
      <h1 className="text-h1">{t("title")}</h1>
      <OfflineBanner />
      {company ? (
        <CompanySettingsForm company={company} />
      ) : (
        <ErrorState
          message={t("UNAVAILABLE")}
          onRetry={() => {
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
