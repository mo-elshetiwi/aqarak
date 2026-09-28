import { useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react-native";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme/colors";
const subscribeOnline = (listener: () => void): (() => void) =>
  onlineManager.subscribe(listener);
/** Decisions requiring the server share one reactive connectivity guard. */
export function useOnlineRequirement(): {
  allowed: boolean;
  reason: string | undefined;
} {
  const allowed = useSyncExternalStore(subscribeOnline, () =>
    onlineManager.isOnline(),
  );
  const t = useTranslations("Mobile.Connectivity");
  return { allowed, reason: allowed ? undefined : t("required") };
}
/** A persistent attention banner reports the most recent successful cache update in Dubai time. */
export function OfflineBanner(): ReactNode {
  const { allowed } = useOnlineRequirement();
  const cache = useQueryClient().getQueryCache();
  const updatedAt = useSyncExternalStore(
    (listener) => cache.subscribe(listener),
    () =>
      cache
        .getAll()
        .reduce(
          (latest, query) => Math.max(latest, query.state.dataUpdatedAt),
          0,
        ),
  );
  if (allowed) return null;
  return <OfflineState updatedAt={updatedAt} />;
}
/** The same offline presentation can display a fixed synthetic example without changing connectivity. */
export function OfflineState({
  updatedAt = 0,
}: {
  updatedAt?: number;
}): ReactNode {
  const t = useTranslations("Mobile.Connectivity");
  const colors = useThemeColors();
  const time = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Dubai",
  }).format(updatedAt);
  return (
    <SafeAreaView edges={["top"]} className="bg-status-attention-bg">
      <View
        testID="offline-banner"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="flex-row items-center gap-2 border-b border-status-attention-border px-4 py-3"
      >
        <WifiOff
          size={24}
          color={colors.statusAttentionFg}
          accessible={false}
        />
        <Text className="flex-1 text-status-attention-fg">
          {updatedAt ? t("cached", { time }) : t("offline")}
        </Text>
      </View>
    </SafeAreaView>
  );
}
