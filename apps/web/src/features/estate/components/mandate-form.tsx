"use client";
import { useState, type SubmitEvent, type ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EstateMoneyAmount } from "./fils-amount";
import {
  aedAmountSchema,
  mandateInputSchema,
  type MandateInput,
  type OwnerDetail,
} from "../contract";
import { putMandateAction } from "../actions";
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
import type { FormError } from "@/components/system/screen-states";
function decimal(fils: string): string {
  const n = BigInt(fils);
  return `${String(n / 100n)}.${String(n % 100n).padStart(2, "0")}`;
}
function textValue(data: FormData, key: string): string {
  const v = data.get(key);
  return typeof v === "string" ? v : "";
}
function initialChoice(owner: OwnerDetail): string {
  if (owner.mandate?.ownerGate == null) return "default";
  return owner.mandate.ownerGate ? "on" : "off";
}
function mandateFields(owner: OwnerDetail) {
  const mandate = owner.mandate;
  return [
    [
      "costThresholdFils",
      "costThresholdAed",
      "text",
      mandate?.costThresholdFils != null
        ? decimal(mandate.costThresholdFils)
        : "0",
    ],
    [
      "feeBp",
      "fee",
      "text",
      mandate?.feeBp == null ? "" : decimal(String(mandate.feeBp)),
    ],
    ["startsOn", "startsOn", "date", mandate?.startsOn ?? ""],
    ["endsOn", "endsOn", "date", mandate?.endsOn ?? ""],
  ] as const;
}
export function MandateForm({
  companyId,
  owner,
}: {
  companyId: string;
  owner: OwnerDetail;
}): ReactElement {
  const t = useTranslations("Owners");
  const locale = useLocale();
  const router = useRouter();
  const form = useEstateForm("Owners");
  const context = useActionContext(companyId, form.key);
  const [choice, setChoice] = useState(() => initialChoice(owner));
  const [answers, setAnswers] = useState<MandateInput | null>(null);
  const changed = Boolean(owner.mandate && choice !== initialChoice(owner));
  function check(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const money = aedAmountSchema.safeParse(
      textValue(data, "costThresholdFils"),
    );
    const fee = aedAmountSchema.safeParse(textValue(data, "feeBp") || "0");
    if (!money.success || !fee.success) {
      form.setErrors([
        {
          fieldId: !money.success ? "costThresholdFils" : "feeBp",
          message: t("moneyInvalid"),
        },
      ]);
      return;
    }
    if (changed && !textValue(data, "reason").trim()) {
      form.failure("REASON_REQUIRED", "reason");
      return;
    }
    const parsed = mandateInputSchema.safeParse({
      expectedVersion: owner.mandate?.version ?? null,
      ownerGate: choice === "default" ? null : choice === "on",
      costThresholdFils: money.data,
      feeBp: Number(fee.data),
      startsOn: textValue(data, "startsOn"),
      endsOn: textValue(data, "endsOn") || null,
      propertyIds: data.getAll("propertyIds"),
      ...(textValue(data, "reason")
        ? { reason: textValue(data, "reason") }
        : {}),
    });
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
    setAnswers(parsed.data);
  }
  function save() {
    if (!answers) return;
    form.submit(
      () =>
        putMandateAction(
          context,
          { ...answers, expectedVersion: owner.mandate?.version ?? null },
          [owner.id],
        ),
      () => {
        router.push(
          `${estateBase(locale, companyId)}/owners/${owner.id}?saved=mandate`,
        );
      },
    );
  }
  return (
    <div className="max-w-3xl space-y-6">
      <EstateHeader title={t(answers ? "checkAnswers" : "mandate")} />
      <FormFeedback form={form} />
      <form
        noValidate
        hidden={Boolean(answers)}
        onSubmit={check}
        className="space-y-6"
      >
        <fieldset className="space-y-3">
          <legend className="text-h3">{t("approval")}</legend>
          {(
            [
              ["on", "gateOn"],
              ["off", "gateOff"],
              ["default", "gateDefault"],
            ] as const
          ).map(([value, key]) => (
            <label key={value} className="flex items-start gap-3">
              <input
                className="mt-1"
                type="radio"
                name="ownerGate"
                value={value}
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                }}
              />
              <span>{t(key)}</span>
            </label>
          ))}
        </fieldset>
        <MandateFields owner={owner} errors={form.errors} />
        {changed && (
          <Field id="reason" label={t("reason")} errors={form.errors}>
            <textarea
              id="reason"
              name="reason"
              required
              className={`${controlClass} min-h-24`}
              {...fieldAccessibility("reason", form.errors)}
            />
          </Field>
        )}
        <Button
          id="mandate-continue"
          type="submit"
          variant={answers ? "secondary" : "default"}
        >
          {t("continue")}
        </Button>
      </form>
      {answers && (
        <MandateAnswers
          answers={answers}
          owner={owner}
          pending={form.pending}
          onChange={() => {
            setAnswers(null);
          }}
          onSave={save}
        />
      )}
    </div>
  );
}
function MandateFields({
  owner,
  errors,
}: {
  owner: OwnerDetail;
  errors: FormError[];
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        {mandateFields(owner).map(([id, label, type, value]) => (
          <Field key={id} id={id} label={t(label)} errors={errors}>
            <input
              id={id}
              name={id}
              type={type}
              dir="ltr"
              inputMode={type === "text" ? "decimal" : undefined}
              defaultValue={value}
              className={controlClass}
              {...fieldAccessibility(id, errors)}
            />
          </Field>
        ))}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-h3">{t("covered")}</legend>
        {owner.properties.length ? (
          owner.properties.map((property) => (
            <label key={property.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="propertyIds"
                value={property.id}
                defaultChecked={owner.mandate?.propertyIds.includes(
                  property.id,
                )}
              />
              {property.name[locale]}
            </label>
          ))
        ) : (
          <p>{t("noProperties")}</p>
        )}
      </fieldset>
    </>
  );
}
function MandateAnswers({
  answers,
  owner,
  pending,
  onChange,
  onSave,
}: {
  answers: MandateInput;
  owner: OwnerDetail;
  pending: boolean;
  onChange: () => void;
  onSave: () => void;
}): ReactElement {
  const t = useTranslations("Owners");
  const language = useLocale();
  const locale = language === "ar" ? "ar" : "en";
  const effect =
    answers.ownerGate === null
      ? "effectDefault"
      : answers.ownerGate
        ? "effectOn"
        : "effectOff";
  return (
    <div className="space-y-6">
      <p className="text-body-strong">{t(effect)}</p>
      <dl className="grid grid-cols-2 gap-4">
        <dt>{t("costThreshold")}</dt>
        <dd>
          <EstateMoneyAmount fils={answers.costThresholdFils} locale={locale} />
        </dd>
        <dt>{t("fee")}</dt>
        <dd>
          <bdi dir="ltr">
            {t("feeValue", { value: decimal(String(answers.feeBp ?? 0)) })}
          </bdi>
        </dd>
        <dt>{t("period")}</dt>
        <dd>
          <bdi dir="ltr">{answers.startsOn}</bdi> ·{" "}
          <bdi dir="ltr">{answers.endsOn ?? t("openEnded")}</bdi>
        </dd>
        <dt>{t("covered")}</dt>
        <dd>
          {owner.properties
            .filter((p) => answers.propertyIds.includes(p.id))
            .map((p) => p.name[locale])
            .join(locale === "ar" ? "، " : ", ") || t("noProperties")}
        </dd>
        {answers.reason && (
          <>
            <dt>{t("reason")}</dt>
            <dd>{answers.reason}</dd>
          </>
        )}
      </dl>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="link"
          disabled={pending}
          onClick={onChange}
        >
          {t("change")}
        </Button>
        <Button
          id="form-submit"
          type="button"
          disabled={pending}
          onClick={onSave}
        >
          {t(pending ? "saving" : "saveMandate")}
        </Button>
      </div>
    </div>
  );
}
