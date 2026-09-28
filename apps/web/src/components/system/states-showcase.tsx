"use client";
import { useMemo, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShowcaseShell, ShowcaseSection } from "./showcase-shell";
import {
  StatusTag,
  statusCatalogue,
  statusEntries,
  type StatusEntity,
} from "./status-tag";
import {
  EmptyState,
  ErrorState,
  ErrorSummary,
  FieldError,
  NotFoundState,
  NotPermittedState,
  OfflineBanner,
  DemoBanner,
  PageSkeleton,
  TableSkeleton,
} from "./screen-states";
export function StatesShowcase(): ReactElement {
  const translate = useTranslations("States");
  const status = useTranslations("Status");
  const common = useTranslations("Common");
  const [action, setAction] = useState("");
  const errors = useMemo(
    () => [
      { fieldId: "error-owner", message: common("nameError") },
      { fieldId: "error-email", message: common("emailError") },
    ],
    [common],
  );
  return (
    <ShowcaseShell states>
      {(Object.keys(statusCatalogue) as StatusEntity[]).map((entity) => (
        <ShowcaseSection key={entity} title={status(`entities.${entity}`)}>
          <div className="flex flex-wrap gap-4">
            {statusEntries
              .filter((entry) => entry.entity === entity)
              .map((entry) => (
                <StatusTag key={entry.state} {...entry} />
              ))}
          </div>
        </ShowcaseSection>
      ))}
      <ShowcaseSection title={translate("empty")}>
        <div className="grid gap-6 md:grid-cols-2">
          <EmptyState
            variant="no-records"
            headingLevel="h3"
            onAction={() => document.getElementById("error-owner")?.focus()}
          />
          <EmptyState
            variant="no-matches"
            headingLevel="h3"
            onAction={() => {
              setAction(common("clearFilters"));
            }}
          />
        </div>
        <p role="status" className="text-caption">
          {action}
        </p>
      </ShowcaseSection>
      <ErrorState
        onRetry={() => {
          setAction(common("retry"));
        }}
      />
      <ShowcaseSection title={translate("errors")}>
        <ErrorSummary errors={errors} />
        <form
          className="grid gap-4 md:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {errors.map((error, index) => (
            <div key={error.fieldId} className="space-y-2">
              <Label htmlFor={error.fieldId}>
                {common(index === 0 ? "owner" : "email")}
              </Label>
              <Input
                id={error.fieldId}
                type={index === 0 ? "text" : "email"}
                aria-invalid="true"
                aria-describedby={`${error.fieldId}-message`}
              />
              <FieldError
                id={`${error.fieldId}-message`}
                message={error.message}
              />
            </div>
          ))}
        </form>
      </ShowcaseSection>
      <ShowcaseSection title={translate("access")}>
        <NotFoundState />
        <NotPermittedState />
      </ShowcaseSection>
      <ShowcaseSection title={translate("banners")}>
        <OfflineBanner forceVisible />
        <DemoBanner />
      </ShowcaseSection>
      <ShowcaseSection title={translate("skeletons")}>
        <PageSkeleton />
        <TableSkeleton />
      </ShowcaseSection>
    </ShowcaseShell>
  );
}
