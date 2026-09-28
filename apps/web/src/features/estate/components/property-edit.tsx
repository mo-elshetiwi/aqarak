"use client";
import { useState, type ReactElement, type SubmitEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  propertyUseSchema,
  updatePropertySchema,
  type PropertyDetail,
} from "../contract";
import type { Input } from "../server/routes";
import { updatePropertyAction } from "../actions";
import type { FormError } from "@/components/system/screen-states";
import {
  controlClass,
  EstateHeader,
  Field,
  fieldAccessibility,
  FormFeedback,
  useActionContext,
  useEstateForm,
  estateBase,
} from "./shared";

const textFields = [
  "plotNo",
  "titleDeedNo",
  "prpNumber",
  "onwaniAddress",
  "zone",
] as const;
function approvalChoice(value: boolean | null): string {
  return value === null ? "default" : value ? "on" : "off";
}
function readProperty(data: FormData, property: PropertyDetail): unknown {
  const choice = data.get("ownerGateOverride");
  return {
    expectedVersion: property.version,
    name: { en: data.get("name.en"), ar: data.get("name.ar") },
    ...(data.get("use") ? { use: data.get("use") } : {}),
    ownerGateOverride: choice === "default" ? null : choice === "on",
    ...(data.get("area.en") || data.get("area.ar")
      ? { area: { en: data.get("area.en"), ar: data.get("area.ar") } }
      : {}),
    ...Object.fromEntries(
      [...textFields, "reason"].flatMap((field) =>
        data.get(field) ? [[field, data.get(field)]] : [],
      ),
    ),
  };
}
export function PropertyEditForm({
  companyId,
  property,
}: {
  companyId: string;
  property: PropertyDetail;
}): ReactElement {
  const t = useTranslations("Properties");
  const locale = useLocale();
  const router = useRouter();
  const form = useEstateForm("Properties");
  const context = useActionContext(companyId, form.key);
  const [choice, setChoice] = useState(() =>
    approvalChoice(property.ownerGateOverride),
  );
  const [answers, setAnswers] = useState<Input<"updateProperty"> | null>(null);
  const changed = choice !== approvalChoice(property.ownerGateOverride);
  function save(input: Input<"updateProperty">) {
    form.submit(
      () =>
        updatePropertyAction(
          context,
          { ...input, expectedVersion: property.version },
          [property.id],
        ),
      () => {
        router.push(
          `${estateBase(locale, companyId)}/properties/${property.id}?saved=property`,
        );
      },
    );
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reason = data.get("reason");
    if (changed && (typeof reason !== "string" || !reason.trim())) {
      form.failure("REASON_REQUIRED", "reason");
      return;
    }
    const parsed = updatePropertySchema.safeParse(readProperty(data, property));
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.join("."),
          message: t("problems.VALIDATION_FAILED"),
        })),
      );
      return;
    }
    form.setErrors([]);
    if (changed) setAnswers(parsed.data);
    else save(parsed.data);
  }
  return (
    <div className="max-w-4xl space-y-6">
      <EstateHeader title={t(answers ? "checkAnswers" : "edit")} />
      <FormFeedback form={form} />
      <form
        noValidate
        onSubmit={submit}
        hidden={Boolean(answers)}
        className="space-y-6"
      >
        <PropertyEditFields property={property} errors={form.errors} />
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
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                }}
              />
              {t(label)}
            </label>
          ))}
        </fieldset>
        {changed && (
          <Field id="reason" label={t("reason")} errors={form.errors}>
            <textarea
              id="reason"
              name="reason"
              required
              maxLength={500}
              className={`${controlClass} min-h-24`}
              {...fieldAccessibility("reason", form.errors)}
            />
          </Field>
        )}
        <Button id="property-continue" type="submit" disabled={form.pending}>
          {t(form.pending ? "saving" : changed ? "continue" : "save")}
        </Button>
      </form>
      {answers && (
        <div className="space-y-5">
          <p className="text-body-strong">
            {t(
              answers.ownerGateOverride === null
                ? "effectFollow"
                : answers.ownerGateOverride
                  ? "effectOn"
                  : "effectOff",
            )}
          </p>
          <p>{answers.reason}</p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={form.pending}
              onClick={() => {
                setAnswers(null);
              }}
            >
              {t("change")}
            </Button>
            <Button
              id="form-submit"
              disabled={form.pending}
              onClick={() => {
                save(answers);
              }}
            >
              {t(form.pending ? "saving" : "save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function PropertyEditFields({
  property,
  errors,
}: {
  property: PropertyDetail;
  errors: FormError[];
}): ReactElement {
  const t = useTranslations("Properties");
  const fields = [
    ["name.en", "fullNameEn", property.name.en],
    ["name.ar", "fullNameAr", property.name.ar],
    ["area.en", "areaEn", property.area?.en ?? ""],
    ["area.ar", "areaAr", property.area?.ar ?? ""],
    ...textFields.map(
      (field) => [field, field, property[field] ?? ""] as const,
    ),
  ] as const;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {fields.map(([id, label, value]) => (
        <Field key={id} id={id} label={t(label)} errors={errors}>
          <input
            id={id}
            name={id}
            dir={id.endsWith(".ar") ? "rtl" : "ltr"}
            defaultValue={value}
            className={controlClass}
            {...fieldAccessibility(id, errors)}
          />
        </Field>
      ))}
      <Field id="use" label={t("use")} errors={errors}>
        <select
          id="use"
          name="use"
          defaultValue={property.use ?? ""}
          className={controlClass}
          {...fieldAccessibility("use", errors)}
        >
          <option value="">{t("notProvided")}</option>
          {propertyUseSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`uses.${value}`)}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
