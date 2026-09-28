import type { ReactNode } from "react";
import {
  CircleDashed,
  Clock,
  Contrast,
  CircleCheck,
  TriangleAlert,
  CircleMinus,
} from "lucide-react-native";
import { useTranslations } from "use-intl";
import { Tag } from "@/components/ui/tag";
import { useThemeColors } from "@/theme/colors";
import { stateTones, statusTagSchema, type StatusTagProps } from "./states";
const icons = {
  neutral: CircleDashed,
  attention: Clock,
  progress: Contrast,
  success: CircleCheck,
  danger: TriangleAlert,
  muted: CircleMinus,
};
/** Words and icons accompany every tone; Contrast is Lucide's half-filled circle. */
export function StatusTag(input: StatusTagProps): ReactNode {
  const props = statusTagSchema.parse(input);
  const t = useTranslations("Mobile.Status");
  const colors = useThemeColors();
  const foreground = {
    neutral: colors.statusNeutralFg,
    attention: colors.statusAttentionFg,
    progress: colors.statusProgressFg,
    success: colors.statusSuccessFg,
    danger: colors.statusDangerFg,
    muted: colors.statusMutedFg,
  };
  const tone = stateTones[props.state];
  const Icon = icons[tone];
  const label =
    props.domain === "draftedAction"
      ? t(`draftedAction.${props.state}`)
      : props.domain === "approval"
        ? t(`approval.${props.state}`)
        : t(`contract.${props.state}`);
  return (
    <Tag
      tone={tone}
      accessibilityLabel={label}
      icon={
        <Icon
          testID={`status-icon-${tone}`}
          size={12}
          color={foreground[tone]}
          accessible={false}
        />
      }
    >
      {label}
    </Tag>
  );
}
