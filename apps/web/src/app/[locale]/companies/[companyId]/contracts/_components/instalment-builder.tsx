"use client";
import type { ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/system/screen-states";
import { MoneyAmount } from "@/components/system/formatted-values";
import { formatMoney } from "@/lib/format";
import {
  parseFils,
  splitFils,
  type InstalmentRow,
} from "../_lib/draft-helpers";
interface Props {
  rows: InstalmentRow[];
  onChange: (rows: InstalmentRow[]) => void;
  totalFils: number;
  locale: Locale;
  disabled?: boolean;
  errors: Record<string, string>;
}
const columns = [
  { key: "dueOn", label: "dueOn", type: "date" },
  { key: "chequeNo", label: "chequeNo", type: "text" },
  { key: "bankName", label: "bankName", type: "text" },
  { key: "amount", label: "amountFils", type: "text" },
] as const;
export function InstalmentBuilder({
  rows,
  onChange,
  totalFils,
  locale,
  disabled = false,
  errors,
}: Props): ReactElement {
  const t = useTranslations("Contracts");
  const amounts = rows.map((row) => parseFils(row.amount));
  const total = amounts.reduce((a, b) => a + b, 0);
  const sum = Number.isSafeInteger(total) ? total : 0;
  const difference = Number.isSafeInteger(totalFils) ? sum - totalFils : 0;
  function split(): void {
    const amounts = splitFils(totalFils, rows.length);
    if (amounts.length)
      onChange(
        rows.map((row, index) => ({
          ...row,
          amount: ((amounts[index] ?? 0) / 100).toFixed(2),
        })),
      );
  }
  return (
    <section
      id="instalments"
      tabIndex={-1}
      className="space-y-4 rounded-lg border bg-card p-6"
      aria-labelledby="instalments-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="instalments-heading" className="text-h2">
          {t("instalments")}
        </h2>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !Number.isSafeInteger(totalFils)}
          onClick={split}
        >
          {t("split")}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-start">
          <thead>
            <tr>
              <th scope="col" className="p-2 text-start">
                {t("seqNo")}
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="p-2 text-start">
                  {t(column.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <th scope="row" className="p-2 text-start tabular-nums">
                  {index + 1}
                </th>
                {columns.map((column) => {
                  const id = `instalments-${String(index)}-${column.key === "amount" ? "amountFils" : column.key === "chequeNo" || column.key === "bankName" ? `cheque-${column.key}` : column.key}`;
                  const error = errors[id];
                  return (
                    <td className="min-w-36 p-2 align-top" key={column.key}>
                      <Input
                        id={id}
                        type={column.type}
                        aria-label={t("fieldLabel", {
                          label: t(column.label),
                          number: index + 1,
                        })}
                        value={row[column.key]}
                        inputMode={
                          column.key === "amount" ? "decimal" : undefined
                        }
                        onChange={(event) => {
                          onChange(
                            rows.map((item, i) =>
                              i === index
                                ? { ...item, [column.key]: event.target.value }
                                : item,
                            ),
                          );
                        }}
                        disabled={disabled}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${id}-error` : undefined}
                      />
                      {error && (
                        <FieldError id={`${id}-error`} message={error} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div role="status" aria-live="polite" className="space-y-2">
        <MoneyAmount fils={sum} locale={locale} />
        <p>
          {difference === 0
            ? t("totalEqual", { amount: formatMoney(sum, locale) })
            : t("totalDifference", {
                amount: formatMoney(sum, locale),
                difference: formatMoney(Math.abs(difference), locale),
                direction: t(difference > 0 ? "above" : "below"),
              })}
        </p>
      </div>
      {errors.instalments && (
        <FieldError id="instalments-error" message={errors.instalments} />
      )}
    </section>
  );
}
