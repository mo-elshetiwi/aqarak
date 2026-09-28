import { useContext, type ComponentProps, type ReactElement } from "react";
import { TextInput } from "react-native";
import { TextLocaleContext, textStyle } from "@/theme/typography";
import { useThemeColors } from "@/theme/colors";
import { cn } from "@/lib/utils";
/** Native text entry retains platform paste, autofill and password-manager support. */
export function Input({
  style,
  className,
  ...props
}: ComponentProps<typeof TextInput>): ReactElement {
  const locale = useContext(TextLocaleContext);
  const colors = useThemeColors();
  return (
    <TextInput
      {...props}
      style={[textStyle(locale, "bodyLg"), { color: colors.foreground }, style]}
      placeholderTextColor={colors.mutedForeground}
      selectionColor={colors.brand}
      className={cn(
        "h-12 rounded-lg border border-input bg-background px-3",
        className,
      )}
    />
  );
}
