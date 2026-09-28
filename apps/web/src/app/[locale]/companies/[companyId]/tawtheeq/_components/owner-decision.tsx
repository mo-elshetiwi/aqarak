"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { PageHeader } from "@/components/system/page-header";
import { Button } from "@/components/ui/button";
import { useCsrfToken } from "@/components/shell/session-context";
import { tawtheeqAction } from "../[recordId]/_actions";
import { contractValues } from "../_lib/fixtures";
import { fieldKeySchema, type TawtheeqRecord } from "../_lib/schemas";
import {
  ActionError,
  Connectivity,
  controlClass,
  Value,
  WorkflowStatus,
} from "./common";
import { useMutation } from "./use-mutation";
export function OwnerDecisionScreen({
  initialRecord,
  companyId,
  locale,
}: {
  initialRecord: TawtheeqRecord;
  companyId: string;
  locale: Locale;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const csrfToken = useCsrfToken();
  const [record, setRecord] = useState(initialRecord);
  const [reason, setReason] = useState("");
  const [keys, setKeys] = useState(() => ({
    approve: crypto.randomUUID(),
    return: crypto.randomUUID(),
  }));
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, submit } = useMutation(async (action, key) => {
    const result = await tawtheeqAction({
      ...action,
      companyId,
      recordId: record.id,
      csrfToken,
      idempotencyKey: key,
    });
    if (result.ok) {
      setRecord(result.record);
      setSaved(true);
    }
    return result;
  });
  const reapproval = record.workflowState === "awaiting_owner_reapproval";
  async function decide(decision: "approve" | "return"): Promise<void> {
    if (decision === "return" && !reason.trim()) {
      setError({
        ok: false,
        code: "VALIDATION_FAILED",
        fieldErrors: { "input.reason": ["REASON_REQUIRED"] },
      });
      return;
    }
    await submit(
      reapproval
        ? {
            command: "ownerReapproval",
            input: {
              expectedVersion: record.version,
              decision,
              ...(reason.trim() ? { reason } : {}),
            },
          }
        : {
            command: "skipConfirmation",
            input: { decision, ...(reason.trim() ? { reason } : {}) },
          },
      keys[decision],
    );
  }
  const prior = contractValues(record);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("recordTitle", { contract: record.contract.contractNo })}
      />
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-h2">{t("ownerSummary")}</h2>
        <WorkflowStatus state={record.workflowState} />
        <p>
          {t("contract")}: <bdi>{record.contract.contractNo}</bdi> · {t("unit")}
          : <bdi>{record.contract.unit.unitNo}</bdi>
        </p>
        <p>{t("ownerSession")}</p>
      </section>
      <Connectivity />
      {saved ? (
        <p
          role="status"
          className="rounded-md border border-status-success-border bg-status-success-bg p-4 text-status-success-fg"
        >
          {t("ownerDecisionSaved")}
        </p>
      ) : (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <h2 className="text-h2">
            {t(reapproval ? "ownerDecisionTitle" : "skipOwnerTitle")}
          </h2>
          {reapproval && record.adoption && (
            <table className="w-full text-start">
              <caption className="sr-only">{t("ownerDecisionTitle")}</caption>
              <thead>
                <tr>
                  {["field", "priorValue", "adoptedValue"].map((key) => (
                    <th scope="col" key={key} className="p-2 text-start">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(record.adoption.changedFields).map(
                  ([field, value]) => {
                    const parsed = fieldKeySchema.safeParse(field);
                    return (
                      <tr key={field} className="border-t">
                        <th scope="row" className="p-2 text-start">
                          {parsed.success ? (
                            t(`fields.${parsed.data}`)
                          ) : (
                            <bdi>{field}</bdi>
                          )}
                        </th>
                        <td className="p-2">
                          {parsed.success ? (
                            <Value
                              field={parsed.data}
                              value={prior[field] ?? null}
                              locale={locale}
                            />
                          ) : (
                            <bdi>{String(prior[field] ?? "")}</bdi>
                          )}
                        </td>
                        <td className="p-2">
                          {parsed.success ? (
                            <Value
                              field={parsed.data}
                              value={value}
                              locale={locale}
                            />
                          ) : (
                            <bdi>{String(value)}</bdi>
                          )}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          )}
          {!reapproval && (
            <>
              <p>{t("skipWarning")}</p>
              <p>
                {t("reasonSaved")}: <bdi>{record.skipReason}</bdi>
              </p>
            </>
          )}
          <p>
            {t(
              reapproval ? "ownerDecisionConsequence" : "skipOwnerConsequence",
            )}
          </p>
          <ActionError error={error} />
          <label className="block" htmlFor="owner-reason">
            {t("reason")}
          </label>
          <textarea
            id="owner-reason"
            maxLength={2000}
            className={controlClass}
            value={reason}
            aria-invalid={Boolean(error?.fieldErrors["input.reason"])}
            onChange={(event) => {
              setReason(event.target.value);
              setKeys({
                approve: crypto.randomUUID(),
                return: crypto.randomUUID(),
              });
            }}
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                void decide("return");
              }}
            >
              {t("return")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void decide("approve");
              }}
            >
              {t("approve")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
