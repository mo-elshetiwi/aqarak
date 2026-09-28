"use client";
import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { SourceViewer } from "@/components/review/source-viewer";
import { Button } from "@/components/ui/button";
import type { DocumentUrl } from "../_lib/schemas";
export function CertificateSource({
  source,
  synthetic,
  retry,
}: {
  source: DocumentUrl | null;
  synthetic: boolean;
  retry: () => void;
}): ReactElement {
  const t = useTranslations("Tawtheeq");
  if (!source)
    return (
      <div className="space-y-4 rounded-lg border p-6">
        <p>{t("sourceUnavailable")}</p>
        <Button variant="outline" onClick={retry}>
          {t("retry")}
        </Button>
      </div>
    );
  if (source.contentType === "application/pdf")
    return (
      <section
        aria-label={t("source")}
        className="space-y-3 rounded-lg border p-4"
      >
        <p>{t("pdfHelp")}</p>
        <iframe
          title={t("source")}
          src={source.url}
          className="h-[70vh] w-full"
        />
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center text-brand underline"
        >
          {t("openSource")}
        </a>
      </section>
    );
  return (
    <SourceViewer
      document={{
        title: t(synthetic ? "syntheticCertificate" : "source"),
        synthetic,
        pages: [{ number: 1, imageSrc: source.url, alt: t("source") }],
      }}
      selection={null}
    />
  );
}
