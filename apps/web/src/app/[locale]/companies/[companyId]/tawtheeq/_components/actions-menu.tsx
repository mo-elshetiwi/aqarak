"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { TawtheeqRecord } from "../_lib/schemas";
import { SkipDialog } from "./skip-dialog";
import { ActionError, controlClass } from "./common";
import { useMutation, type RunAction } from "./use-mutation";
export function ActionsMenu({
  record,
  run,
  replace,
}: {
  record: TawtheeqRecord;
  run: RunAction;
  replace: () => void;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  const [reason, setReason] = useState("");
  const [attested, setAttested] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { busy, error, submit } = useMutation(run);
  const options = [
    "attest_portal",
    "portal_return",
    "skip",
    "resume",
    "upload",
  ].filter((a) => record.allowedActions.includes(a));
  if (!options.length) return <></>;
  return (
    <details className="rounded-md border p-3">
      <summary className="flex min-h-8 cursor-pointer items-center font-semibold">
        {t("actions")}
      </summary>
      <div className="mt-4 max-w-xl space-y-4">
        {options.includes("attest_portal") && (
          <div className="space-y-3">
            <label className="flex min-h-6 items-center gap-3">
              <input
                type="checkbox"
                className="size-6"
                checked={attested}
                onChange={(e) => {
                  setAttested(e.target.checked);
                }}
              />
              {t("attestCheck")}
            </label>
            <Button
              variant="secondary"
              disabled={!attested || busy}
              onClick={() => {
                void submit(
                  {
                    command: "attestPortal",
                    input: { expectedVersion: record.version },
                  },
                  key,
                );
              }}
            >
              {t("attest")}
            </Button>
          </div>
        )}
        {options.includes("portal_return") && (
          <>
            <label htmlFor="menu-reason" className="block">
              {t("reason")}
            </label>
            <textarea
              id="menu-reason"
              className={controlClass}
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setKey(crypto.randomUUID());
              }}
            />
            {options.includes("portal_return") && (
              <Button
                variant="secondary"
                disabled={!reason.trim() || busy}
                onClick={() => {
                  void submit(
                    {
                      command: "portalReturn",
                      input: { expectedVersion: record.version, reason },
                    },
                    key,
                  );
                }}
              >
                {t("portalReturn")}
              </Button>
            )}
          </>
        )}
        {options.includes("skip") && <SkipDialog record={record} run={run} />}
        {options.includes("resume") && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void submit(
                {
                  command: "resume",
                  input: { expectedVersion: record.version },
                },
                key,
              );
            }}
          >
            {t("resume")}
          </Button>
        )}
        {options.includes("upload") &&
          record.workflowState === "registered" && (
            <Button variant="secondary" onClick={replace}>
              {t("replaceUpload")}
            </Button>
          )}
        <ActionError error={error} />
      </div>
    </details>
  );
}
