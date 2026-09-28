import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./text";
const tones = {
  neutral: [
    "bg-status-neutral-bg border-status-neutral-border",
    "text-status-neutral-fg",
  ],
  attention: [
    "bg-status-attention-bg border-status-attention-border",
    "text-status-attention-fg",
  ],
  progress: [
    "bg-status-progress-bg border-status-progress-border",
    "text-status-progress-fg",
  ],
  success: [
    "bg-status-success-bg border-status-success-border",
    "text-status-success-fg",
  ],
  danger: [
    "bg-status-danger-bg border-status-danger-border",
    "text-status-danger-fg",
  ],
  muted: [
    "bg-status-muted-bg border-status-muted-border",
    "text-status-muted-fg",
  ],
} as const;
/** Provenance labels and compact status labels share the same text and token primitive. */
export function Tag({
  children,
  tone,
  icon,
  accessibilityLabel,
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
  icon?: ReactNode;
  accessibilityLabel?: string;
}): ReactNode {
  if (!tone)
    return (
      <View className="self-start rounded-md bg-status-attention-bg px-2 py-1">
        <Text variant="caption" className="text-status-attention-fg">
          {children}
        </Text>
      </View>
    );
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      className={`min-h-6 flex-row items-center gap-1 self-start rounded border px-2 ${tones[tone][0]}`}
    >
      {icon}
      <Text variant="captionStrong" className={tones[tone][1]}>
        {children}
      </Text>
    </View>
  );
}
