"use client";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  Search,
  TriangleAlert,
  Clock,
  WifiOff,
  CircleDashed,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";

export type EmptyStateProps = {
  headingLevel?: "h2" | "h3";
  message?: string;
  actionLabel?: string;
} & (
  | { variant: "no-records"; onAction?: () => void }
  | { variant: "no-matches"; onAction: () => void }
);
export function EmptyState({
  variant,
  onAction,
  headingLevel: Heading = "h2",
  message,
  actionLabel,
}: EmptyStateProps): ReactElement {
  const translate = useTranslations("States");
  const common = useTranslations("Common");
  const Icon =
    variant === "no-matches" ? Search : onAction ? Users : CircleDashed;
  return (
    <div className="flex flex-col items-start gap-4 rounded-md border p-6">
      <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      <Heading className={Heading === "h2" ? "text-h2" : "text-h3"}>
        {message ??
          translate(variant === "no-records" ? "emptyOwners" : "noMatches")}
      </Heading>
      {onAction && (
        <Button
          variant={variant === "no-records" ? "default" : "secondary"}
          onClick={onAction}
        >
          {actionLabel ??
            common(variant === "no-records" ? "addOwner" : "clearFilters")}
        </Button>
      )}
    </div>
  );
}
export function ErrorState({
  onRetry,
  message,
}: {
  onRetry: () => void;
  message?: string;
}): ReactElement {
  const translate = useTranslations("States");
  const common = useTranslations("Common");
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-4 rounded-md border border-status-danger-border bg-status-danger-bg p-6 text-status-danger-fg"
    >
      <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
      <p className="text-body">{message ?? translate("loadError")}</p>
      <Button variant="outline" onClick={onRetry}>
        {common("retry")}
      </Button>
    </div>
  );
}
export interface FormError {
  fieldId: string;
  message: string;
}
export function ErrorSummary({
  errors,
}: {
  errors: readonly FormError[];
}): ReactElement | null {
  const translate = useTranslations("States");
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) summary.current?.focus();
  }, [errors]);
  if (!errors.length) return null;
  return (
    <div
      ref={summary}
      tabIndex={-1}
      role="alert"
      className="rounded-md border border-status-danger-border bg-status-danger-bg p-6 text-status-danger-fg"
    >
      <h2 className="text-h2">{translate("errorSummary")}</h2>
      <ul className="mt-4 space-y-2">
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              className="inline-flex min-h-6 items-center underline underline-offset-4"
              href={`#${error.fieldId}`}
              onClick={() => document.getElementById(error.fieldId)?.focus()}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function FieldError({
  id,
  message,
}: {
  id: string;
  message: string;
}): ReactElement {
  return (
    <p
      id={id}
      className="flex items-start gap-2 text-body text-status-danger-fg"
    >
      <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
      {message}
    </p>
  );
}
export function NotFoundState(): ReactElement {
  const translate = useTranslations("States");
  const common = useTranslations("Common");
  return (
    <div className="flex flex-col items-start gap-4 rounded-md border p-6">
      <p>{translate("notFound")}</p>
      <Link href="/" className={buttonVariants({ variant: "link" })}>
        {common("home")}
      </Link>
    </div>
  );
}
export function NotPermittedState(): ReactElement {
  const translate = useTranslations("States");
  const common = useTranslations("Common");
  return (
    <div className="flex flex-col items-start gap-4 rounded-md border p-6">
      <p>{translate("notPermitted")}</p>
      <Link href="/" className={buttonVariants({ variant: "link" })}>
        {common("home")}
      </Link>
    </div>
  );
}
function subscribeConnectivity(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
export function OfflineBanner({
  forceVisible = false,
}: {
  forceVisible?: boolean;
}): ReactElement | null {
  const translate = useTranslations("States");
  const online = useSyncExternalStore(
    subscribeConnectivity,
    () => navigator.onLine,
    () => true,
  );
  if (online && !forceVisible) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-status-attention-border bg-status-attention-bg p-4 text-status-attention-fg"
    >
      <WifiOff className="mt-1 size-5 shrink-0" aria-hidden="true" />
      <p>{translate("offline")}</p>
    </div>
  );
}
export function DemoBanner(): ReactElement {
  const translate = useTranslations("States");
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-status-attention-border bg-status-attention-bg p-4 text-status-attention-fg"
    >
      <Clock className="mt-1 size-5 shrink-0" aria-hidden="true" />
      <p>{translate("demo")}</p>
    </div>
  );
}
export function TableSkeleton(): ReactElement {
  const translate = useTranslations("Common");
  return (
    <div
      role="status"
      aria-label={translate("loading")}
      className="overflow-hidden rounded-md border"
    >
      <span className="sr-only">{translate("loading")}</span>
      <div
        aria-hidden="true"
        className="flex h-9 items-center gap-4 border-b bg-muted ps-4 pe-4"
      >
        {[0, 1, 2].map((column) => (
          <Skeleton key={column} className="h-3 w-1/3" />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          aria-hidden="true"
          key={row}
          className="flex h-11 items-center gap-4 border-b ps-4 pe-4 last:border-b-0"
        >
          {[0, 1, 2].map((column) => (
            <Skeleton key={column} className="h-4 w-1/3" />
          ))}
        </div>
      ))}
    </div>
  );
}
export function PageSkeleton(): ReactElement {
  const translate = useTranslations("Common");
  return (
    <div role="status" aria-label={translate("loading")} className="space-y-8">
      <span className="sr-only">{translate("loading")}</span>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-(--text-h1--line-height) w-48" />
        <Skeleton className="h-(--text-body--line-height) w-3/4" />
      </div>
      <div aria-hidden="true" className="grid gap-6 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-6 rounded-md border p-6">
            <CircleDashed className="size-5 text-muted-foreground" />
            <Skeleton className="h-(--text-body--line-height) w-3/4" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
