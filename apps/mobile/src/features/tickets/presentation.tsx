import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { asReportError } from "@/features/report/client";
import { reportButtonClass } from "@/features/report/presentation";

/** I treat missing and forbidden reports as the same terminal state. */
export function isTicketUnavailable(error: unknown): boolean {
  return ["NOT_FOUND", "NOT_AUTHORISED", "UNAUTHENTICATED"].includes(
    asReportError(error).code,
  );
}

/** I keep recovery adjacent to the message and omit it for inaccessible records. */
export function TicketFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): ReactNode {
  const t = useTranslations("Maintenance");
  const unavailable = isTicketUnavailable(error);
  const code = asReportError(error).code;
  return (
    <View
      testID="ticket-failure"
      className="flex-row flex-wrap items-center gap-3"
      accessibilityLiveRegion="polite"
    >
      <Text accessibilityRole="alert" className="flex-1">
        {t(
          unavailable
            ? "unavailable"
            : code === "INVALID_REQUEST" || code === "INVALID_INPUT"
              ? "invalidInput"
              : "couldNotLoad",
        )}
      </Text>
      {!unavailable && (
        <Button
          variant="secondary"
          className={reportButtonClass}
          label={t("retry")}
          onPress={onRetry}
        />
      )}
    </View>
  );
}

/** I use the shared connectivity signal while keeping successfully loaded content mounted. */
export function TicketOffline(): ReactNode {
  const t = useTranslations("Maintenance");
  return (
    <View className="rounded-lg border border-status-attention-border bg-status-attention-bg p-4">
      <Text accessibilityRole="alert" className="text-status-attention-fg">
        {t("offline")}
      </Text>
    </View>
  );
}
