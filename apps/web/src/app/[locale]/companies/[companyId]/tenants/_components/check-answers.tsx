"use client";
import { useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorSummary, FieldError } from "@/components/system/screen-states";
import { saveIdentityAction } from "../_lib/actions";
import {
  fieldCatalogue,
  type TenantDetail,
  type VersionDetail,
  type Problem,
} from "../_lib/j3-contract";
import { tenantPath, reviewPath, type ReviewRoute } from "../_lib/routes";
export function CheckAnswers({
  route,
  tenantVersion,
  version,
}: {
  route: ReviewRoute;
  tenantVersion: TenantDetail["version"];
  version: VersionDetail;
}): ReactElement {
  const t = useTranslations("Documents");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  const expiry = version.decisions.find(
    (item) => item.fieldName === "expiry_date",
  )?.value;
  const incomplete = fieldCatalogue.some(
    (field) => !version.decisions.some((item) => item.fieldName === field.name),
  );
  async function save(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      const result = await saveIdentityAction({
        ...route,
        expectedTenantVersion: tenantVersion,
        key: key.current,
      });
      if (result.ok) {
        router.push(`${tenantPath(route)}?identity=saved`);
        router.refresh();
      } else setError(result);
    } catch {
      setError({ code: "UNAVAILABLE" });
    } finally {
      setPending(false);
      busy.current = false;
    }
  }
  return (
    <div className="space-y-6">
      {error && (
        <ErrorSummary
          errors={[
            { fieldId: "save-identity", message: t(`errors.${error.code}`) },
          ]}
        />
      )}
      {error?.code === "STALE_VERSION" && (
        <Button
          variant="outline"
          onClick={() => {
            key.current = null;
            setError(null);
            router.refresh();
          }}
        >
          {t("reload")}
        </Button>
      )}
      {incomplete && (
        <FieldError
          id="review-incomplete"
          message={t("errors.REVIEW_INCOMPLETE")}
        />
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <dl className="divide-y rounded-md border bg-card">
          {fieldCatalogue.map((field) => {
            const decision = version.decisions.find(
              (item) => item.fieldName === field.name,
            );
            return (
              <div
                key={field.name}
                className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
              >
                <dt className="text-muted-foreground">
                  {t(`fields.${field.name}`)}
                </dt>
                <dd className="space-y-2">
                  <p className="text-body-strong">
                    <bdi dir={field.name.endsWith("_ar") ? "rtl" : "auto"}>
                      {decision?.value ?? t("provenance.not_on_document")}
                    </bdi>
                  </p>
                  {decision && (
                    <p className="text-caption">
                      {t(
                        `provenance.${decision.decision === "not_on_document" ? "not_on_document" : decision.provenance}`,
                      )}
                    </p>
                  )}
                </dd>
                <dd>
                  <Link
                    className={buttonVariants({ variant: "link", size: "sm" })}
                    href={`${reviewPath(route)}?field=${field.name}`}
                    aria-label={t("changeField", {
                      field: t(`fields.${field.name}`),
                    })}
                  >
                    {t("change")}
                  </Link>
                </dd>
              </div>
            );
          })}
        </dl>
        <section
          className="space-y-4 rounded-md border bg-card p-6"
          aria-labelledby="consequence-heading"
        >
          <h2 id="consequence-heading" className="text-h2">
            {t("consequence")}
          </h2>
          <p>{t("acceptedConsequence")}</p>
          <p>
            {t("expiry")}: <bdi>{expiry ?? t("noExpiry")}</bdi>
          </p>
          <p>{t("taskConsequence")}</p>
          <p>{t("auditConsequence")}</p>
          <dl className="space-y-2 text-caption">
            <div>
              <dt>{t("sourceImage")}</dt>
              <dd>
                <bdi>{version.fileName}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t("model")}</dt>
              <dd>
                <bdi>
                  {version.modelCall
                    ? `${version.modelCall.registryEntry} / ${version.modelCall.promptVersion}`
                    : t("manualVersion")}
                </bdi>
              </dd>
            </div>
          </dl>
          <p className="rounded-md border bg-muted p-4">
            {t("noNotification")}
          </p>
          {error && (
            <FieldError id="save-error" message={t(`errors.${error.code}`)} />
          )}
          <div className="flex flex-wrap gap-2">
            <Link
              href={reviewPath(route)}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("backReview")}
            </Link>
            <Button
              id="save-identity"
              disabled={
                pending || incomplete || error?.code === "STALE_VERSION"
              }
              onClick={() => {
                void save();
              }}
            >
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
