import type { ReactNode } from "react";
import { FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslations } from "use-intl";
import { minimumTargetSize, spaceUnitPx } from "@aqarak/ui-tokens";
import { formatDate } from "@/components/format/format";
import { ScreenHeader } from "@/components/shell/screen-header";
import { LoadingState } from "@/components/states/screen-states";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useLocale } from "@/features/locale/locale-provider";
import { useOnlineRequirement } from "@/features/query/connectivity";
import type { TicketSummary, TicketsPage } from "@/features/report/contract";
import { reportButtonClass } from "@/features/report/presentation";
import { useTickets } from "./hooks";
import {
  isTicketUnavailable,
  TicketFailure,
  TicketOffline,
} from "./presentation";
import { TicketStatusTag } from "./ticket-status-tag";

function TicketRow({ ticket }: { ticket: TicketSummary }): ReactNode {
  const t = useTranslations("Maintenance");
  const router = useRouter();
  const category = t(`category.${ticket.category}`);
  const reported = t("reportedDate", { date: formatDate(ticket.createdAt) });
  return (
    <Pressable
      testID={`ticket-row-${ticket.id}`}
      accessibilityRole="link"
      accessibilityLabel={[
        category,
        ticket.unitLabel,
        t(`status.${ticket.status}`),
        t(`priority.${ticket.priority}`),
        reported,
      ].join(", ")}
      className="gap-2 rounded-lg border border-border bg-card p-4"
      style={{ minHeight: minimumTargetSize.androidDp }}
      onPress={() => {
        router.push(`/tickets/${ticket.id}`);
      }}
    >
      <Text variant="h2">{category}</Text>
      <Text>{ticket.unitLabel}</Text>
      <View className="flex-row flex-wrap items-center gap-3">
        <TicketStatusTag status={ticket.status} />
        <Text>{t(`priority.${ticket.priority}`)}</Text>
      </View>
      <Text style={{ fontVariant: ["tabular-nums"] }}>{reported}</Text>
    </Pressable>
  );
}

function sortedTickets(
  pages: TicketsPage[] | undefined,
  unavailable: boolean,
): TicketSummary[] {
  if (unavailable) return [];
  return (pages?.flatMap((page) => page.items) ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** I show the API's scoped records without applying a second tenant filter. */
export function TicketsScreen(): ReactNode {
  const t = useTranslations("Maintenance");
  const router = useRouter();
  const { direction } = useLocale();
  const { allowed } = useOnlineRequirement();
  const query = useTickets();
  const unavailable = query.error && isTicketUnavailable(query.error);
  const items = sortedTickets(query.data?.pages, Boolean(unavailable));
  function retry(): void {
    if (!allowed) return;
    if (query.isFetchNextPageError) void query.fetchNextPage();
    else void query.refetch();
  }
  return (
    <SafeAreaView
      testID="tickets-screen"
      className="flex-1 bg-background"
      edges={["top", "left", "right"]}
      style={{ direction }}
    >
      <FlatList
        testID="tickets-list"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TicketRow ticket={item} />}
        contentContainerStyle={{
          padding: spaceUnitPx * 4,
          gap: spaceUnitPx * 4,
        }}
        refreshing={allowed && query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => {
          if (allowed && !unavailable) void query.refetch();
        }}
        ListHeaderComponent={
          <View className="gap-4">
            <ScreenHeader title={t("title")} />
            <Button
              testID="report-problem"
              className={reportButtonClass}
              label={t("report")}
              onPress={() => {
                router.push("/report");
              }}
            />
            {!allowed && <TicketOffline />}
            {query.error && (allowed || unavailable) && (
              <TicketFailure error={query.error} onRetry={retry} />
            )}
          </View>
        }
        ListEmptyComponent={
          query.isPending && allowed ? (
            <LoadingState />
          ) : query.isSuccess ? (
            <Text>{t("empty")}</Text>
          ) : null
        }
        ListFooterComponent={
          query.hasNextPage && !unavailable ? (
            <Button
              variant="secondary"
              className={reportButtonClass}
              label={t("loadMore")}
              loading={query.isFetchingNextPage}
              disabled={!allowed || query.isFetching}
              onPress={() => {
                void query.fetchNextPage();
              }}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}
