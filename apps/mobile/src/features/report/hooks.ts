import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { config } from "@/config";
import { useSession } from "@/features/auth/session-provider";
import { subscribe } from "@/features/auth/session-events";
import { companyQueryKey } from "@/features/query/cache";
import { commandKey, type ReportClient } from "./client";
import { createHttpReportClient } from "./http-client";
import { createFixtureReportClient } from "./fixture-client";
import type { ConfirmIntakeBody, RejectIntakeBody } from "./contract";
const clients = new WeakMap<typeof fetch, Map<string, ReportClient>>();
/** I require the same active company scope as the shared query cache. */
export function useReportScope(): { accountId: string; companyId: string } {
  const { state } = useSession();
  if (state.status !== "signed_in" || !state.activeCompanyId)
    throw new Error("An active tenant context is required");
  return { accountId: state.account.id, companyId: state.activeCompanyId };
}
/** I retain an adapter for each session and company so synthetic drafts survive navigation. */
export function useReportClient(): ReportClient {
  const { authorisedFetch } = useSession();
  const { accountId, companyId } = useReportScope();
  useEffect(() => {
    const clear = (): void => {
      clients.delete(authorisedFetch);
    };
    const stop = [
      subscribe("signed_out", clear),
      subscribe("context_changed", clear),
    ];
    return () => {
      stop.forEach((remove) => {
        remove();
      });
    };
  }, [authorisedFetch]);
  return useMemo(() => {
    let scoped = clients.get(authorisedFetch);
    if (!scoped) {
      scoped = new Map();
      clients.set(authorisedFetch, scoped);
    }
    const key = `${accountId}:${companyId}:${config.adapter}`;
    let client = scoped.get(key);
    if (!client) {
      client =
        config.adapter === "http"
          ? createHttpReportClient(config.baseUrl, authorisedFetch, fetch)
          : createFixtureReportClient();
      scoped.set(key, client);
    }
    return client;
  }, [accountId, companyId, authorisedFetch]);
}
/** I preserve problem details by passing the authorised adapter directly to the scoped query. */
export function useReportUnits(): ReturnType<
  typeof useQuery<Awaited<ReturnType<ReportClient["units"]>>>
> {
  const { state } = useSession();
  const { companyId } = useReportScope();
  const client = useReportClient();
  return useQuery({
    queryKey: companyQueryKey(state, ["report", "units"]),
    queryFn: ({ signal }) => client.units(companyId, signal),
  });
}
/** I always refresh a review visit before allowing a decision. */
export function useIntake(
  intakeId: string,
): ReturnType<typeof useQuery<Awaited<ReturnType<ReportClient["getIntake"]>>>> {
  const { state } = useSession();
  const { companyId } = useReportScope();
  const client = useReportClient();
  return useQuery({
    queryKey: companyQueryKey(state, ["report", "intake", intakeId]),
    queryFn: ({ signal }) => client.getIntake(companyId, intakeId),
    refetchOnMount: "always",
  });
}
/** I retain one confirmation key for this review visit, including retries after timeouts. */
export function useConfirmIntake(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<ReportClient["confirmIntake"]>>,
    Error,
    { intakeId: string; body: ConfirmIntakeBody }
  >
> {
  const client = useReportClient();
  const { companyId } = useReportScope();
  const { state } = useSession();
  const [key] = useState(commandKey);
  return useMutation({
    mutationKey: companyQueryKey(state, ["report", "confirm"]),
    mutationFn: ({ intakeId, body }) =>
      client.confirmIntake(companyId, intakeId, body, key),
  });
}
/** I give rejection a separate logical command, never the confirmation key. */
export function useRejectIntake(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<ReportClient["rejectIntake"]>>,
    Error,
    { intakeId: string; body: RejectIntakeBody }
  >
> {
  const client = useReportClient();
  const { companyId } = useReportScope();
  const { state } = useSession();
  const [key] = useState(commandKey);
  return useMutation({
    mutationKey: companyQueryKey(state, ["report", "reject"]),
    mutationFn: ({ intakeId, body }) =>
      client.rejectIntake(companyId, intakeId, body, key),
  });
}

/** I invalidate late work as soon as navigation or the authenticated scope changes. */
export function useReportLifetime(): () => boolean {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const invalidate = (): void => {
      active.current = false;
    };
    const stop = [
      subscribe("signed_out", invalidate),
      subscribe("context_changed", invalidate),
    ];
    return () => {
      invalidate();
      stop.forEach((remove) => {
        remove();
      });
    };
  }, []);
  return useCallback(() => active.current, []);
}
