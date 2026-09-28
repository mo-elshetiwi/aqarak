import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Pressable, View } from "react-native";
import { Clock, Inbox, SearchX, TriangleAlert } from "lucide-react-native";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/status/status-tag";
import { useThemeColors } from "@/theme/colors";
/** An honest empty sentence can use the existing role-specific catalogue text. */
export function EmptyState({
  sentence,
  action,
}: {
  sentence?: string;
  action?: { label: string; onPress: () => void };
}): ReactNode {
  const t = useTranslations("Mobile.States");
  const colors = useThemeColors();
  return (
    <View className="gap-4">
      <Inbox size={24} color={colors.mutedForeground} accessible={false} />
      <Text variant="h3">{sentence ?? t("empty")}</Text>
      {action && <Button label={action.label} onPress={action.onPress} />}
    </View>
  );
}
/** Skeleton heights match compact and expanded rows; reduced motion uses a static fill. */
export function LoadingState(): ReactNode {
  const t = useTranslations("Mobile.States");
  const [reduced, setReduced] = useState(true);
  const colors = useThemeColors();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduced(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [reduced, opacity]);
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("loading")}
      testID={reduced ? "loading-static" : "loading-animated"}
      style={{ opacity }}
      className="gap-3"
    >
      <Clock size={24} color={colors.mutedForeground} accessible={false} />
      <View
        testID="skeleton-compact"
        className="rounded-lg bg-muted"
        style={{ height: 56 }}
      />
      <View
        testID="skeleton-expanded"
        className="rounded-lg bg-muted"
        style={{ height: 72 }}
      />
    </Animated.View>
  );
}
/** A translated plain cause and one retry action replace technical exception output. */
export function ErrorState({
  cause,
  onRetry,
}: {
  cause?: string;
  onRetry: () => void;
}): ReactNode {
  const t = useTranslations("Mobile.States");
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap items-center gap-3">
      <TriangleAlert
        size={24}
        color={colors.mutedForeground}
        accessible={false}
      />
      <Text accessibilityRole="alert" className="flex-1">
        {cause ?? t("error")}
      </Text>
      <Button variant="secondary" label={t("retry")} onPress={onRetry} />
    </View>
  );
}
/** Missing and out-of-scope records intentionally share this exact presentation. */
export function NotFoundState({ onHome }: { onHome: () => void }): ReactNode {
  const t = useTranslations("Mobile.States");
  const colors = useThemeColors();
  return (
    <View className="gap-4">
      <SearchX size={24} color={colors.mutedForeground} accessible={false} />
      <Text>{t("notFound")}</Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t("home")}
        onPress={onHome}
        className="min-h-12 justify-center"
      >
        <Text className="text-brand">{t("home")}</Text>
      </Pressable>
    </View>
  );
}
/** A stale draft requires a new draft rather than a decision on outdated data. */
export function ExpiredDraftState({
  onDraftAgain,
}: {
  onDraftAgain: () => void;
}): ReactNode {
  const t = useTranslations("Mobile.States");
  const colors = useThemeColors();
  return (
    <View className="gap-4">
      <Clock size={24} color={colors.mutedForeground} accessible={false} />
      <Text>{t("expired")}</Text>
      <Button label={t("draftAgain")} onPress={onDraftAgain} />
    </View>
  );
}
/** The caller supplies the frozen approval stepper; submitted versions remain read-only. */
export function PendingApprovalState({
  name,
  role,
  age,
  stepper,
}: {
  name: string;
  role: "manager" | "owner" | "tenant";
  age: string;
  stepper: ReactNode;
}): ReactNode {
  const t = useTranslations("Mobile.States");
  const colors = useThemeColors();
  return (
    <View className="gap-4">
      <Clock size={24} color={colors.mutedForeground} accessible={false} />
      <StatusTag domain="approval" state="requested" />
      {stepper}
      <Text>{t("waiting", { name, role: t(`roles.${role}`), age })}</Text>
      <Text>{t("locked")}</Text>
    </View>
  );
}
