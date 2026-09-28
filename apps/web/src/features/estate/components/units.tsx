"use client";
import { useState, type ReactElement, type SubmitEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/system/screen-states";
import { IdentifierText } from "@/components/system/formatted-values";
import { StatusTag } from "@/components/system/status-tag";
import {
  createUnitsSchema,
  unitKindSchema,
  unitUseSchema,
  type UnitItem,
} from "../contract";
import { UnitActions } from "./unit-actions";
import { createUnitsAction } from "../actions";
import {
  cellClass,
  controlClass,
  EstateHeader,
  Field,
  fieldAccessibility,
  FormFeedback,
  useEstateForm,
  useActionContext,
  estateBase,
} from "./shared";
export function UnitsTable({
  units,
  companyId,
  propertyId,
  manager = true,
}: {
  units: UnitItem[];
  companyId?: string;
  propertyId?: string;
  manager?: boolean;
}): ReactElement {
  const t = useTranslations("Units");
  const [filter, setFilter] = useState("all");
  const [updates, setUpdates] = useState<Record<string, UnitItem>>({});
  const effective = units.map((unit) => {
    const updated = updates[unit.id];
    return updated && updated.version >= unit.version ? updated : unit;
  });
  const visible = effective.filter(
    (u) =>
      filter === "all" ||
      (filter === "attention"
        ? ["reserved", "notice_given", "under_maintenance", "blocked"].includes(
            u.status,
          )
        : u.status === filter),
  );
  return (
    <section className="space-y-4">
      <div
        role="group"
        aria-label={t("status")}
        className="flex flex-wrap gap-1"
      >
        {(["all", "occupied", "vacant", "attention"] as const).map((value) => (
          <Button
            key={value}
            variant="secondary"
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
            }}
          >
            {t(`filters.${value}`)}
          </Button>
        ))}
      </div>
      <p aria-live="polite">
        {t("count", { count: visible.length })}
        {Object.keys(updates).length > 0 && (
          <span className="ms-2">{t("saved")}</span>
        )}
      </p>
      {visible.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[
                  "unit",
                  "untNumber",
                  "kind",
                  "bedrooms",
                  "status",
                  "blockReason",
                  ...(manager && companyId && propertyId ? ["actions"] : []),
                ].map((key) => (
                  <th scope="col" key={key} className={cellClass}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((unit) => (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  companyId={companyId}
                  propertyId={propertyId}
                  manager={manager}
                  onSaved={(next) => {
                    setUpdates((current) => ({ ...current, [next.id]: next }));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : filter !== "all" ? (
        <EmptyState
          variant="no-matches"
          message={t("noMatches")}
          actionLabel={t("clearFilters")}
          onAction={() => {
            setFilter("all");
          }}
        />
      ) : (
        <EmptyState variant="no-records" message={t("empty")} />
      )}
      <p className="text-caption text-muted-foreground">{t("statusesHelp")}</p>
    </section>
  );
}
function rowInput(data: FormData, index: number): unknown {
  const field = (name: string) => data.get(`units[${String(index)}].${name}`);
  return {
    unitNo: field("unitNo"),
    use: field("use"),
    kind: field("kind"),
    ...(field("untNumber") ? { untNumber: field("untNumber") } : {}),
    ...(field("bedrooms") ? { bedrooms: Number(field("bedrooms")) } : {}),
    ...(field("areaSqm") ? { areaSqm: field("areaSqm") } : {}),
  };
}
export function UnitsForm({
  companyId,
  propertyId,
}: {
  companyId: string;
  propertyId: string;
}): ReactElement {
  const t = useTranslations("Units");
  const locale = useLocale();
  const router = useRouter();
  const form = useEstateForm("Units");
  const context = useActionContext(companyId, form.key);
  const [rows, setRows] = useState(() => [crypto.randomUUID()]);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = createUnitsSchema.safeParse({
      units: rows.map((_, index) => rowInput(data, index)),
    });
    if (!parsed.success) {
      form.setErrors(
        parsed.error.issues.map((issue) => ({
          fieldId: issue.path.reduce<string>(
            (path, part) =>
              typeof part === "number"
                ? `${path}[${String(part)}]`
                : path
                  ? `${path}.${String(part)}`
                  : String(part),
            "",
          ),
          message: t("problems.VALIDATION_FAILED"),
        })),
      );
      return;
    }
    form.submit(
      () => createUnitsAction(context, parsed.data, [propertyId]),
      () => {
        router.push(
          `${estateBase(locale, companyId)}/properties/${propertyId}`,
        );
      },
    );
  }
  return (
    <div className="space-y-6">
      <EstateHeader title={t("title")} />
      <form noValidate onSubmit={submit} className="space-y-6">
        <FormFeedback form={form} />
        {rows.map((row, index) => (
          <fieldset key={row} className="space-y-4 border-b pb-5">
            <legend className="text-h3">
              {t("row", { number: index + 1 })}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {(["unitNo", "untNumber", "bedrooms", "areaSqm"] as const).map(
                (name) => {
                  const id = `units[${String(index)}].${name}`;
                  return (
                    <Field
                      key={id}
                      id={id}
                      label={t(name)}
                      errors={form.errors}
                    >
                      <input
                        id={id}
                        name={id}
                        dir="ltr"
                        type={
                          name === "bedrooms" || name === "areaSqm"
                            ? "number"
                            : "text"
                        }
                        min="0"
                        step={name === "areaSqm" ? "any" : "1"}
                        className={controlClass}
                        {...fieldAccessibility(id, form.errors)}
                      />
                    </Field>
                  );
                },
              )}
              {(
                [
                  ["use", unitUseSchema.options, "uses"],
                  ["kind", unitKindSchema.options, "kinds"],
                ] as const
              ).map(([name, options, namespace]) => {
                const id = `units[${String(index)}].${name}`;
                return (
                  <Field key={id} id={id} label={t(name)} errors={form.errors}>
                    <select
                      id={id}
                      name={id}
                      className={controlClass}
                      {...fieldAccessibility(id, form.errors)}
                    >
                      {options.map((value) => (
                        <option key={value} value={value}>
                          {t(`${namespace}.${value}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                );
              })}
            </div>
            <Button
              type="button"
              variant="link"
              className="transition-none"
              disabled={rows.length === 1 || form.pending}
              onClick={() => {
                setRows((current) => current.filter((id) => id !== row));
                form.setErrors([]);
              }}
            >
              {t("removeRow", { number: index + 1 })}
            </Button>
          </fieldset>
        ))}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={rows.length >= 100 || form.pending}
            onClick={() => {
              setRows((current) => [...current, crypto.randomUUID()]);
            }}
          >
            {t("addRow")}
          </Button>
          <Button id="form-submit" type="submit" disabled={form.pending}>
            {t(form.pending ? "saving" : "submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function UnitRow({
  unit,
  companyId,
  propertyId,
  manager,
  onSaved,
}: {
  unit: UnitItem;
  companyId: string | undefined;
  propertyId: string | undefined;
  manager: boolean;
  onSaved: (unit: UnitItem) => void;
}): ReactElement {
  const t = useTranslations("Units");
  return (
    <tr>
      <td className={cellClass}>
        <bdi dir="ltr">{unit.unitNo}</bdi>
      </td>
      <td className={cellClass}>
        {unit.untNumber ? (
          <IdentifierText kind="unt" value={unit.untNumber} />
        ) : (
          t("notProvided")
        )}
      </td>
      <td className={cellClass}>{t(`kinds.${unit.kind}`)}</td>
      <td className={cellClass}>
        <bdi dir="ltr">{unit.bedrooms ?? t("notProvided")}</bdi>
      </td>
      <td className={cellClass}>
        <StatusTag entity="unit" state={unit.status} />
      </td>
      <td className={cellClass}>
        {unit.blockReason
          ? t(`blockReasons.${unit.blockReason}`)
          : t("notProvided")}
      </td>
      {manager && companyId && propertyId && (
        <td className={cellClass}>
          <UnitActions
            unit={unit}
            companyId={companyId}
            propertyId={propertyId}
            onSaved={onSaved}
          />
        </td>
      )}
    </tr>
  );
}
