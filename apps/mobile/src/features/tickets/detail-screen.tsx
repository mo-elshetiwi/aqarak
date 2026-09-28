import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslations } from "use-intl";
import { spaceUnitPx } from "@aqarak/ui-tokens";
import { formatDate } from "@/components/format/format";
import { LoadingState } from "@/components/states/screen-states";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useLocale } from "@/features/locale/locale-provider";
import { useOnlineRequirement } from "@/features/query/connectivity";
import type { TicketView } from "@/features/report/contract";
import { reportButtonClass } from "@/features/report/presentation";
import { useTicket } from "./hooks";
import {
  isTicketUnavailable,
  TicketFailure,
  TicketOffline,
} from "./presentation";
import { TicketPhoto } from "./photo";
import { TicketStatusTag } from "./ticket-status-tag";

const nextActors = {
  reported: "office",
  triaged: "office",
  awaiting_quote: "office",
  awaiting_cost_approval: "owner",
  scheduled: "technician",
  in_progress: "technician",
  on_hold: "office",
  work_completed: "tenant",
  closed: "none",
  cancelled: "none",
} as const satisfies Record<TicketView["status"], string>;

function TicketContent({ ticket }: { ticket: TicketView }): ReactNode {
  const t = useTranslations("Maintenance");
  const photos = ticket.media.filter((media) => media.kind === "photo");
  const voices = ticket.media.filter((media) => media.kind === "voice_note");
  return (
    <View className="gap-6">
      <View testID="ticket-identity" className="gap-3">
        <Text variant="h1">{t(`category.${ticket.category}`)}</Text>
        <Text>{ticket.unitLabel}</Text>
        <TicketStatusTag status={ticket.status} />
        <Text variant="h2">{t("whatNext")}</Text>
        <Text>
          {t("nextActor", { actor: t(`actor.${nextActors[ticket.status]}`) })}
        </Text>
        <Text>{t(`nextStep.${ticket.status}`)}</Text>
      </View>
      <View className="gap-2">
        <Text>{t(`priority.${ticket.priority}`)}</Text>
        <Text style={{ fontVariant: ["tabular-nums"] }}>
          {t("reportedDate", { date: formatDate(ticket.createdAt) })}
        </Text>
      </View>
      <View className="gap-2">
        <Text variant="h2">{t("yourWords")}</Text>
        <Text>
          {ticket.transcript?.trim() ? ticket.transcript : t("notProvided")}
        </Text>
      </View>
      <View className="gap-2">
        <Text variant="h2">{t("description")}</Text>
        <Text>
          {ticket.description?.trim() ? ticket.description : t("notProvided")}
        </Text>
      </View>
      <View className="gap-2">
        <Text variant="h2">{t("safety")}</Text>
        {ticket.safetyFlags.length > 0 ? (
          ticket.safetyFlags.map((flag) => (
            <View
              key={flag}
              testID={`safety-flag-${flag}`}
              className="rounded-lg border border-status-danger-border bg-status-danger-bg p-4"
            >
              <Text accessibilityRole="alert" className="text-status-danger-fg">
                {t(`safetyFlag.${flag}`)}
              </Text>
            </View>
          ))
        ) : (
          <Text>{t("noSafetyFlags")}</Text>
        )}
      </View>
      <View className="gap-3">
        <Text variant="h2">{t("photos")}</Text>
        {photos.length > 0 ? (
          photos.map((media, index) => (
            <TicketPhoto key={media.id} mediaId={media.id} number={index + 1} />
          ))
        ) : (
          <Text>{t("noPhotos")}</Text>
        )}
      </View>
      {voices.map((media) => (
        <Text key={media.id} style={{ fontVariant: ["tabular-nums"] }}>
          {t("voiceNote", {
            duration:
              media.durationMs === null
                ? t("durationUnavailable")
                : `${String(Math.floor(media.durationMs / 60000))}:${String(Math.floor(media.durationMs / 1000) % 60).padStart(2, "0")}`,
          })}
        </Text>
      ))}
    </View>
  );
}

/** I put identity, responsibility and the next step before supporting report metadata. */
export function TicketDetailScreen({
  ticketId,
}: {
  ticketId: string;
}): ReactNode {
  const t = useTranslations("Maintenance");
  const router = useRouter();
  const { direction } = useLocale();
  const { allowed } = useOnlineRequirement();
  const query = useTicket(ticketId);
  const unavailable = query.error && isTicketUnavailable(query.error);
  return (
    <SafeAreaView
      testID="ticket-detail"
      className="flex-1 bg-background"
      edges={["top", "left", "right"]}
      style={{ direction }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: spaceUnitPx * 4,
          gap: spaceUnitPx * 6,
        }}
      >
        <Button
          variant="ghost"
          className={reportButtonClass}
          label={t("backToReports")}
          onPress={() => {
            router.replace("/tenant/maintenance");
          }}
        />
        {!allowed && <TicketOffline />}
        {query.error && (allowed || unavailable) && (
          <TicketFailure
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )}
        {query.isPending && allowed && <LoadingState />}
        {query.data && !unavailable && <TicketContent ticket={query.data} />}
      </ScrollView>
    </SafeAreaView>
  );
}
