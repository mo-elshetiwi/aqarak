"use client";
import { PendingInvitationNotice } from "@/components/invitation/pending-notice";
import { useState, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorSummary } from "@/components/system/screen-states";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { CompanyKind } from "@/lib/api/contract";
import { FormField, SubmitButton } from "./form-controls";
import { useSubmission } from "./use-submission";
import { validateFields } from "./validation";
export function CompanyForm(): ReactElement {
  const translate = useTranslations("Auth");
  const locale = useLocale();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<CompanyKind>("management_company");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [tradeLicenceNumber, setLicence] = useState("");
  const { pending, errors, submit } = useSubmission();
  const licenceFields =
    kind === "management_company" ? { tradeLicenceNumber } : {};
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({
          path: "/api/companies",
          body: {
            locale,
            kind,
            nameEn,
            nameAr,
            ...licenceFields,
            idempotencyKey,
          },
          validation: validateFields(
            { nameEn, nameAr, ...licenceFields },
            translate,
          ),
          fields: [
            "nameEn",
            "nameAr",
            ...(kind === "management_company" ? ["tradeLicenceNumber"] : []),
          ],
          locale,
        });
      }}
    >
      <PendingInvitationNotice />
      <ErrorSummary errors={errors} />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">{translate("kind")}</legend>
        <RadioGroup
          value={kind}
          onValueChange={(value: unknown) => {
            if (
              value === "management_company" ||
              value === "self_managed_owner"
            )
              setKind(value);
          }}
          aria-label={translate("kind")}
        >
          {(["management_company", "self_managed_owner"] as const).map(
            (option) => (
              <Label key={option}>
                <RadioGroupItem value={option} />
                {translate(option)}
              </Label>
            ),
          )}
        </RadioGroup>
      </fieldset>
      <FormField
        id="nameEn"
        autoComplete="organization"
        lang="en"
        dir="ltr"
        required
        maxLength={120}
        label={translate("nameEn")}
        hint={translate("companyNameHint")}
        value={nameEn}
        onChange={(event) => {
          setNameEn(event.target.value);
        }}
        errors={errors}
      />
      <FormField
        id="nameAr"
        autoComplete="organization"
        lang="ar"
        dir="rtl"
        required
        maxLength={120}
        label={translate("nameAr")}
        hint={translate("companyNameHint")}
        value={nameAr}
        onChange={(event) => {
          setNameAr(event.target.value);
        }}
        errors={errors}
      />
      {kind === "management_company" && (
        <FormField
          id="tradeLicenceNumber"
          required
          maxLength={40}
          label={translate("licence")}
          hint={translate("licenceHint")}
          value={tradeLicenceNumber}
          onChange={(event) => {
            setLicence(event.target.value);
          }}
          errors={errors}
        />
      )}
      <p className="text-body text-muted-foreground">
        {translate("consequence")}
      </p>
      <SubmitButton pending={pending} label={translate("createCompany")} />
    </form>
  );
}
