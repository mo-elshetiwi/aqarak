"use client";
import type { SubmitEvent, ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/system/screen-states";
import {
  createPropertySchema,
  propertyKindSchema,
  propertyUseSchema,
  type OwnerListItem,
} from "../contract";
import { createPropertyAction } from "../actions";
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
function readInput(data: FormData): unknown {
  const approval = data.get("ownerGateOverride");
  return {
    name: { en: data.get("name.en"), ar: data.get("name.ar") },
    kind: data.get("kind"),
    use: data.get("use"),
    ownerId: data.get("ownerId"),
    ownerGateOverride: approval === "default" ? null : approval === "on",
    ...(data.get("area.en") || data.get("area.ar")
      ? { area: { en: data.get("area.en"), ar: data.get("area.ar") } }
      : {}),
    ...Object.fromEntries(
      ["plotNo", "titleDeedNo", "prpNumber", "onwaniAddress", "zone"].flatMap(
        (key) => (data.get(key) ? [[key, data.get(key)]] : []),
      ),
    ),
  };
}
export function PropertyForm({
  companyId,
  owners,
}: {
  companyId: string;
  owners: OwnerListItem[];
}): ReactElement {
  const t = useTranslations("Properties");
  const ownerT = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const router = useRouter();
  const form = useEstateForm("Properties");
  const context = useActionContext(companyId, form.key);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createPropertySchema.safeParse(
      readInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.join("."),
          message: t("problems.VALIDATION_FAILED"),
        })),
      );
      return;
    }
    form.submit(
      () => createPropertyAction(context, parsed.data),
      (result) => {
        router.push(
          `${estateBase(locale, companyId)}/properties/${result.property.id}?document=title_deed`,
        );
      },
    );
  }
  if (!owners.length)
    return (
      <div className="space-y-6">
        <EstateHeader title={t("add")} />
        <EmptyState
          variant="no-records"
          message={t("ownerRequired")}
          actionLabel={ownerT("add")}
          onAction={() => {
            router.push(`${estateBase(locale, companyId)}/owners/new`);
          }}
        />
      </div>
    );
  return (
    <div className="max-w-4xl space-y-6">
      <EstateHeader title={t("add")} />
      <form noValidate onSubmit={submit} className="space-y-6">
        <FormFeedback form={form} />
        <div className="grid gap-5 sm:grid-cols-2">
          {(
            [
              ["name.en", "fullNameEn"],
              ["name.ar", "fullNameAr"],
              ["area.en", "areaEn"],
              ["area.ar", "areaAr"],
              ["plotNo", "plotNo"],
              ["titleDeedNo", "titleDeedNo"],
              ["prpNumber", "prpNumber"],
              ["onwaniAddress", "onwaniAddress"],
              ["zone", "zone"],
            ] as const
          ).map(([id, label]) => (
            <Field key={id} id={id} label={t(label)} errors={form.errors}>
              <input
                id={id}
                name={id}
                dir={id.endsWith(".ar") ? "rtl" : "ltr"}
                className={controlClass}
                {...fieldAccessibility(id, form.errors)}
              />
            </Field>
          ))}
          {(
            [
              ["kind", propertyKindSchema.options, "kinds"],
              ["use", propertyUseSchema.options, "uses"],
            ] as const
          ).map(([id, options, namespace]) => (
            <Field key={id} id={id} label={t(id)} errors={form.errors}>
              <select
                id={id}
                name={id}
                className={controlClass}
                {...fieldAccessibility(id, form.errors)}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {t(`${namespace}.${option}`)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <Field id="ownerId" label={t("owner")} errors={form.errors}>
            <select
              id="ownerId"
              name="ownerId"
              className={controlClass}
              {...fieldAccessibility("ownerId", form.errors)}
            >
              <option value="">{t("chooseOwner")}</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.fullName[locale]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-h3">{t("approval")}</legend>
          {(
            [
              ["default", "followMandate"],
              ["on", "alwaysOn"],
              ["off", "alwaysOff"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                name="ownerGateOverride"
                type="radio"
                value={value}
                defaultChecked={value === "default"}
              />
              {t(label)}
            </label>
          ))}
        </fieldset>
        <Button id="form-submit" type="submit" disabled={form.pending}>
          {t(form.pending ? "saving" : "add")}
        </Button>
      </form>
    </div>
  );
}
