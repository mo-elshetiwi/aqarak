"use client";
import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { DocumentItem, DocumentTarget } from "../contract";
import {
  checkOwnerDocumentAction,
  checkPropertyDocumentAction,
} from "../actions";
import { documentAction } from "./document-processing";
import { FormFeedback, useActionContext, useEstateForm } from "./shared";

export function DocumentAction({
  companyId,
  recordId,
  entity,
  document,
  docType,
  onOpen,
  variant = "secondary",
}: {
  companyId: string;
  recordId: string;
  entity: DocumentTarget["entity"];
  docType: DocumentItem["docType"];
  document: DocumentItem | undefined;
  onOpen: () => void;
  variant?: "secondary" | "link";
}): ReactElement {
  const namespace = entity === "owners" ? "Owners" : "Properties";
  const t = useTranslations(namespace);
  const router = useRouter();
  const form = useEstateForm(
    namespace,
    `document-action-${document?.documentId ?? `${recordId}-${docType}`}`,
  );
  const context = useActionContext(companyId, form.key);
  const [message, setMessage] = useState<"checking" | "statusChecked" | null>(
    null,
  );
  const version = document?.latest ?? document?.current;
  const action = documentAction(version);
  function activate() {
    if (action !== "check" || !document || !version) {
      onOpen();
      return;
    }
    const check =
      entity === "owners"
        ? checkOwnerDocumentAction
        : checkPropertyDocumentAction;
    form.submit(
      () =>
        check(context, {}, [recordId, document.documentId, version.versionId]),
      (result) => {
        setMessage(result.scanPending ? "checking" : "statusChecked");
        router.refresh();
      },
    );
  }
  return (
    <div className="space-y-2">
      <FormFeedback form={form} />
      <Button
        id={`document-action-${document?.documentId ?? `${recordId}-${docType}`}`}
        type="button"
        variant={variant}
        disabled={form.pending}
        onClick={activate}
      >
        {t(action)}
      </Button>
      <p aria-live="polite">{message && t(message)}</p>
    </div>
  );
}
