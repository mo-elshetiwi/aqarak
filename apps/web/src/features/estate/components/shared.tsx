"use client";
import {
  useRef,
  useState,
  useTransition,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ErrorState,
  ErrorSummary,
  FieldError,
  NotFoundState,
  NotPermittedState,
  type FormError,
} from "@/components/system/screen-states";
import { PageHeader } from "@/components/system/page-header";
import type {
  ActionContext,
  EstateActionResult,
  EstateProblem,
  EstateProblemCode,
} from "../contract";

export const controlClass =
  "h-10 w-full rounded-md border bg-background ps-3 pe-3 text-body text-foreground focus-visible:outline-2 focus-visible:outline-ring";
export const cellClass =
  "h-11 border-b ps-3 pe-3 text-start align-middle text-body whitespace-nowrap";
export function EstateError({
  problem,
  namespace = "Owners",
}: {
  problem: EstateProblem;
  namespace?: "Owners" | "Properties";
}): ReactElement {
  const t = useTranslations(namespace);
  return (
    <div className="space-y-6">
      <EstateHeader title={t("title")} />
      <ProblemBody problem={problem} namespace={namespace} />
    </div>
  );
}
function ProblemBody({
  problem,
  namespace,
}: {
  problem: EstateProblem;
  namespace: "Owners" | "Properties";
}): ReactElement {
  const router = useRouter();
  const t = useTranslations(namespace);
  if (problem.code === "NOT_FOUND") return <NotFoundState />;
  if (problem.code === "FORBIDDEN") return <NotPermittedState />;
  return (
    <ErrorState
      message={t(`problems.${problem.code}`)}
      onRetry={() => {
        router.refresh();
      }}
    />
  );
}
export function EstateDenied({
  namespace,
}: {
  namespace: "Owners" | "Properties";
}): ReactElement {
  const t = useTranslations(namespace);
  return (
    <div className="space-y-6">
      <EstateHeader title={t("title")} />
      <NotPermittedState />
    </div>
  );
}
export function EstateHeader({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description?: string;
  href?: string;
  action?: string;
}): ReactElement {
  const router = useRouter();
  return (
    <PageHeader
      title={title}
      {...(description ? { description } : {})}
      {...(href && action
        ? {
            primaryAction: {
              label: action,
              onClick: () => {
                router.push(href);
              },
            },
          }
        : {})}
    />
  );
}
export function Field({
  id,
  label,
  errors,
  children,
}: {
  id: string;
  label: string;
  errors: readonly FormError[];
  children: ReactNode;
}): ReactElement {
  const error = errors.find((e) => e.fieldId === id);
  return (
    <div className="space-y-2">
      <label className="block text-body-strong" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && <FieldError id={`${id}-error`} message={error.message} />}
    </div>
  );
}
export function fieldAccessibility(
  id: string,
  errors: readonly FormError[],
): { "aria-invalid": boolean; "aria-describedby"?: string } {
  return {
    "aria-invalid": errors.some((e) => e.fieldId === id),
    ...(errors.some((e) => e.fieldId === id)
      ? { "aria-describedby": `${id}-error` }
      : {}),
  };
}
interface FormState {
  errors: FormError[];
  pending: boolean;
  key: string;
  setErrors: (errors: FormError[]) => void;
  submit: <T>(
    work: () => Promise<EstateActionResult<T>>,
    success: (value: T) => void,
  ) => void;
  failure: (code: EstateProblemCode, field?: string) => void;
  conflict: boolean;
}
export function useEstateForm(
  namespace: "Owners" | "Properties" | "Units",
  submitId = "form-submit",
): FormState {
  const t = useTranslations(namespace);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [key, setKey] = useState(() => crypto.randomUUID().replaceAll("-", ""));
  const [pending, startTransition] = useTransition();
  const [conflict, setConflict] = useState(false);
  const busy = useRef(false);
  const failure = (code: EstateProblemCode, field = submitId) => {
    setErrors([{ fieldId: field, message: t(`problems.${code}`) }]);
    setConflict(code === "VERSION_CONFLICT");
  };
  function submit<T>(
    work: () => Promise<EstateActionResult<T>>,
    success: (value: T) => void,
  ) {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          failure(result.code, result.field);
          return;
        }
        setErrors([]);
        setConflict(false);
        setKey(crypto.randomUUID().replaceAll("-", ""));
        success(result.data);
      } catch {
        failure("UNAVAILABLE");
      } finally {
        busy.current = false;
      }
    });
  }
  return { errors, pending, key, setErrors, submit, failure, conflict };
}
export function FormFeedback({
  form,
}: {
  form: Pick<FormState, "errors" | "conflict">;
}): ReactElement {
  const t = useTranslations("Owners");
  const router = useRouter();
  return (
    <>
      <ErrorSummary errors={form.errors} />
      {form.conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            router.refresh();
          }}
        >
          {t("reload")}
        </Button>
      )}
    </>
  );
}
export function useActionContext(
  companyId: string,
  key: string,
): ActionContext {
  const locale = useLocale();
  return {
    locale: locale === "ar" ? "ar" : "en",
    companyId,
    idempotencyKey: key,
  };
}
export function estateBase(locale: string, companyId: string): string {
  return `/${locale}/companies/${companyId}`;
}
