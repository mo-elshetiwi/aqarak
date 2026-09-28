import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSession } from "@/features/auth/session-provider";
import { companyQueryKey } from "@/features/query/cache";
import { useReportClient, useReportScope } from "@/features/report/hooks";
import type {
  MediaLink,
  TicketsPage,
  TicketView,
} from "@/features/report/contract";

/** I retain pages only within the active account and company. */
export function useTickets(): UseInfiniteQueryResult<
  InfiniteData<TicketsPage>
> {
  const { state } = useSession();
  const { companyId } = useReportScope();
  const client = useReportClient();
  return useInfiniteQuery({
    queryKey: companyQueryKey(state, ["maintenance", "tickets"]),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.tickets(companyId, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}

/** I refresh the server view on every visit and leave recovery under tenant control. */
export function useTicket(ticketId: string): UseQueryResult<TicketView> {
  const { state } = useSession();
  const { companyId } = useReportScope();
  const client = useReportClient();
  return useQuery({
    queryKey: companyQueryKey(state, ["maintenance", "ticket", ticketId]),
    queryFn: ({ signal }) => client.ticket(companyId, ticketId, signal),
    refetchOnMount: "always",
    retry: false,
  });
}

/** I obtain a fresh short-lived link on each visit without persisting signed URLs. */
export function useMediaLink(mediaId: string): UseQueryResult<MediaLink> {
  const { state } = useSession();
  const { companyId } = useReportScope();
  const client = useReportClient();
  return useQuery({
    queryKey: companyQueryKey(state, ["maintenance", "media", mediaId]),
    queryFn: ({ signal }) => client.mediaLink(companyId, mediaId, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
}
