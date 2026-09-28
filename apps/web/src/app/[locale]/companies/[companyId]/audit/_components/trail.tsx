"use client";
import { useRef, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@aqarak/i18n";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/system/page-header";
import { useCsrfToken } from "@/components/shell/session-context";
import { Connectivity, controlClass } from "../../tawtheeq/_components/common";
import { auditAction } from "../_actions";
import {
  filterQuery,
  eventFiltersSchema,
  type Anchor,
  type AuditFilters,
  type Events,
  type Verification,
} from "../_lib/schemas";
import { AuditError } from "./states";
import { VerificationBanner } from "./verification";
import { TrailTable } from "./trail-table";
export function AuditTrail({
  initial,
  initialFilters,
  companyId,
  locale,
  synthetic,
}: {
  initial: Events;
  initialFilters: AuditFilters;
  companyId: string;
  locale: Locale;
  synthetic: boolean;
}): ReactElement {
  const t = useTranslations("Audit");
  const csrfToken = useCsrfToken();
  const [page, setPage] = useState(initial);
  const [filters, setFilters] = useState(initialFilters);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const keys = useRef({
    verify: crypto.randomUUID(),
    anchor: crypto.randomUUID(),
  });
  async function load(next: AuditFilters, older = false): Promise<void> {
    if (locked.current) return;
    const parsed = eventFiltersSchema.safeParse(next);
    if (!parsed.success) {
      setError("VALIDATION_FAILED");
      return;
    }
    locked.current = true;
    setBusy("events");
    setError(null);
    try {
      const result = await auditAction({
        companyId,
        csrfToken,
        idempotencyKey: crypto.randomUUID(),
        command: "events",
        filters: next,
      });
      if (result.ok && "events" in result.value) {
        const value = result.value;
        setPage((previous) => ({
          events: older ? [...previous.events, ...value.events] : value.events,
          nextCursor: value.nextCursor,
        }));
        if (!older) setFilters(next);
      } else if (!result.ok) setError(result.error.code);
    } catch {
      setError("UNAVAILABLE");
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  async function command(kind: "verify" | "anchor"): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy(kind);
    setError(null);
    try {
      const result = await auditAction({
        companyId,
        csrfToken,
        idempotencyKey: keys.current[kind],
        command: kind,
      });
      if (result.ok) {
        if ("checkedAt" in result.value) {
          setVerification(result.value);
          setAnchor(null);
        }
        if ("key" in result.value) setAnchor(result.value);
        keys.current[kind] = crypto.randomUUID();
      } else setError(result.error.code);
    } catch {
      setError("UNAVAILABLE");
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  async function download(): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy("export");
    setError(null);
    try {
      const response = await fetch(
        `/${locale}/companies/${companyId}/audit/export?${filterQuery(filters)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "X-Aqarak-CSRF": csrfToken ?? "" },
          redirect: "error",
        },
      );
      if (!response.ok) {
        setError(response.status === 403 ? "NOT_PERMITTED" : "UNAVAILABLE");
        return;
      }
      const filename = /filename="([^"/\\]+\.csv)"/.exec(
        response.headers.get("Content-Disposition") ?? "",
      )?.[1];
      if (!filename) {
        setError("UNAVAILABLE");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch {
      setError("UNAVAILABLE");
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Connectivity namespace="Audit" />
      {synthetic && (
        <p className="text-caption text-muted-foreground">{t("synthetic")}</p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => {
            void command("anchor");
          }}
        >
          {t("anchorNow")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => {
            void download();
          }}
        >
          {t("export")}
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => {
            void command("verify");
          }}
        >
          {t("verify")}
        </Button>
      </div>
      <VerificationBanner
        value={verification}
        anchor={anchor}
        busy={busy}
        locale={locale}
      />
      <AuditError code={error} />
      <AuditFiltersForm
        key={filterQuery(filters)}
        filters={filters}
        busy={busy !== null}
        apply={(next) => {
          void load(next);
        }}
      />
      <div aria-busy={busy === "events"}>
        {page.events.length ? (
          <TrailTable events={page.events} locale={locale} />
        ) : (
          <p role="status" className="rounded-md border p-6">
            {t(Object.keys(filters).length ? "noMatches" : "empty")}
          </p>
        )}
      </div>
      {busy === "export" && <p role="status">{t("exporting")}</p>}
      {page.nextCursor !== null && (
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => {
            void load(
              { ...filters, afterSeq: page.nextCursor ?? undefined },
              true,
            );
          }}
        >
          {t("loadOlder")}
        </Button>
      )}
    </div>
  );
}
function AuditFiltersForm({
  filters,
  busy,
  apply,
}: {
  filters: AuditFilters;
  busy: boolean;
  apply: (filters: AuditFilters) => void;
}): ReactElement {
  const t = useTranslations("Audit");
  const [record, setRecord] = useState(filters.subjectId ?? "");
  const [actor, setActor] = useState(filters.actorAccountId ?? "");
  const [initiator, setInitiator] = useState(filters.initiator ?? "");
  const [refusals, setRefusals] = useState(filters.refusalsOnly === "true");
  function next(only = refusals): AuditFilters {
    return {
      ...(record.trim() ? { subjectId: record.trim() } : {}),
      ...(actor.trim() ? { actorAccountId: actor.trim() } : {}),
      ...(initiator ? { initiator } : {}),
      ...(only ? { refusalsOnly: "true" } : {}),
    } as AuditFilters;
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply(next());
      }}
    >
      <label className="min-w-48 flex-1 space-y-1">
        {t("record")}
        <input
          className={controlClass}
          value={record}
          onChange={(e) => {
            setRecord(e.target.value);
          }}
        />
      </label>
      <label className="min-w-48 flex-1 space-y-1">
        {t("actor")}
        <input
          className={controlClass}
          value={actor}
          onChange={(e) => {
            setActor(e.target.value);
          }}
        />
      </label>
      <label className="min-w-40 space-y-1">
        {t("initiator")}
        <select
          className={controlClass}
          value={initiator}
          onChange={(e) => {
            setInitiator(e.target.value);
          }}
        >
          <option value="">{t("all")}</option>
          {["person", "co_worker", "pipeline", "scheduler"].map((value) => (
            <option key={value} value={value}>
              {t(`initiators.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-2">
        <input
          type="checkbox"
          className="size-5"
          checked={refusals}
          disabled={busy}
          onChange={(e) => {
            setRefusals(e.target.checked);
            apply(next(e.target.checked));
          }}
        />
        {t("refusalsOnly")}
      </label>
      <Button variant="secondary" type="submit" disabled={busy}>
        {t("applyFilters")}
      </Button>
      <Button
        variant="ghost"
        type="button"
        disabled={busy}
        onClick={() => {
          apply({});
        }}
      >
        {t("clearFilters")}
      </Button>
    </form>
  );
}
