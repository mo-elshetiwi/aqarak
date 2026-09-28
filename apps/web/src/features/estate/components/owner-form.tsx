"use client";
import type { SubmitEvent, ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createOwnerSchema, type OwnerDetail } from "../contract";
import { createOwnerAction, updateOwnerAction } from "../actions";
import {
  controlClass,
  EstateHeader,
  Field,
  fieldAccessibility,
  FormFeedback,
  useEstateForm,
  useActionContext,
  estateBase,
} from "./shared";
export function OwnerForm({
  companyId,
  selfManagedAllowed,
  owner,
}: {
  companyId: string;
  selfManagedAllowed: boolean;
  owner?: OwnerDetail;
}): ReactElement {
  const t = useTranslations("Owners");
  const locale = useLocale();
  const router = useRouter();
  const form = useEstateForm("Owners");
  const context = useActionContext(companyId, form.key);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      fullName: { en: data.get("fullName.en"), ar: data.get("fullName.ar") },
      preferredLanguage: data.get("preferredLanguage"),
      ...Object.fromEntries(
        ["email", "phoneE164", "eidNumber", "passportNo"].flatMap((k) =>
          data.get(k) ? [[k, data.get(k)]] : [],
        ),
      ),
      ...(selfManagedAllowed
        ? { selfManaged: data.get("selfManaged") === "on" }
        : {}),
    };
    const parsed = createOwnerSchema.safeParse(input);
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.join("."),
          message:
            issue.path[0] === "eidNumber"
              ? t("eidInvalid")
              : t("problems.VALIDATION_FAILED"),
        })),
      );
      return;
    }
    form.submit(
      () =>
        owner
          ? updateOwnerAction(
              context,
              { ...parsed.data, expectedVersion: owner.version },
              [owner.id],
            )
          : createOwnerAction(context, parsed.data),
      (result) => {
        router.push(
          `${estateBase(locale, companyId)}/owners/${result.owner.id}${owner ? "?saved=owner" : ""}`,
        );
      },
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      <EstateHeader title={t(owner ? "edit" : "add")} />
      <form noValidate onSubmit={submit} className="space-y-6">
        <FormFeedback form={form} />
        <div className="grid gap-5 sm:grid-cols-2">
          {(
            [
              ["fullName.en", "fullNameEn"],
              ["fullName.ar", "fullNameAr"],
              ["email", "email"],
              ["phoneE164", "phoneE164"],
              ["eidNumber", "eidNumber"],
              ["passportNo", "passportNo"],
            ] as const
          ).map(([id, label]) => (
            <Field key={id} id={id} label={t(label)} errors={form.errors}>
              <input
                id={id}
                name={id}
                defaultValue={ownerValue(owner, id)}
                className={controlClass}
                dir={id === "fullName.ar" ? "rtl" : "ltr"}
                type={
                  id === "email" ? "email" : id === "phoneE164" ? "tel" : "text"
                }
                inputMode={id === "eidNumber" ? "numeric" : undefined}
                {...fieldAccessibility(id, form.errors)}
              />
            </Field>
          ))}
        </div>
        <fieldset className="space-y-3">
          <legend className="text-body-strong">{t("preferredLanguage")}</legend>
          {(["en", "ar"] as const).map((language) => (
            <label
              key={language}
              className="me-6 inline-flex items-center gap-2"
            >
              <input
                type="radio"
                name="preferredLanguage"
                value={language}
                defaultChecked={
                  language === (owner?.preferredLanguage ?? locale)
                }
              />
              {t(language === "ar" ? "arabic" : "english")}
            </label>
          ))}
        </fieldset>
        {selfManagedAllowed && !owner && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="selfManaged" />
            {t("selfManaged")}
          </label>
        )}
        <Button id="form-submit" type="submit" disabled={form.pending}>
          {t(form.pending ? "saving" : owner ? "save" : "add")}
        </Button>
      </form>
    </div>
  );
}

function ownerValue(owner: OwnerDetail | undefined, id: string): string {
  if (!owner) return "";
  if (id === "fullName.en") return owner.fullName.en;
  if (id === "fullName.ar") return owner.fullName.ar;
  if (id === "email") return owner.email ?? "";
  if (id === "phoneE164") return owner.phoneE164 ?? "";
  return "";
}
