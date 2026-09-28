import type { ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { TicketDetailScreen } from "@/features/tickets/detail-screen";
/** I isolate detail state and photo links by the visited ticket. */
export default function TicketRoute(): ReactNode {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  return <TicketDetailScreen key={ticketId} ticketId={ticketId} />;
}
