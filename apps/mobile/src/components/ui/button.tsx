import type { ComponentProps, ReactElement } from "react";
import { ActivityIndicator, Pressable } from "react-native";
import { Text, TextClassContext } from "./text";
import { cn } from "@/lib/utils";
import { useThemeColors } from "@/theme/colors";
const variants = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  outline: "border border-input bg-background",
  ghost: "",
  destructive: "bg-destructive",
  link: "",
};
const labels = {
  primary: "text-primary-foreground",
  secondary: "text-secondary-foreground",
  outline: "text-foreground",
  ghost: "text-foreground",
  destructive: "text-destructive-foreground",
  link: "text-brand",
};
/** A labelled control keeps its text visible during pending work. */
export type ButtonProps = ComponentProps<typeof Pressable> & {
  variant?: keyof typeof variants;
  size?: "default" | "compact";
  loading?: boolean;
  label: string;
};
/** A minimum touch area preserves access even for compact visual controls. */
export function Button({
  variant = "primary",
  size = "default",
  loading = false,
  label,
  className,
  disabled = false,
  ...props
}: ButtonProps): ReactElement {
  const colors = useThemeColors();
  const spinner =
    variant === "primary"
      ? colors.primaryForeground
      : variant === "destructive"
        ? colors.destructiveForeground
        : colors.foreground;
  return (
    <TextClassContext.Provider value={labels[variant]}>
      <Pressable
        {...props}
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityState={{
          ...props.accessibilityState,
          disabled: disabled === true || loading,
          busy: loading,
        }}
        disabled={disabled === true || loading}
        hitSlop={size === "compact" ? 4 : 0}
        className={cn(
          "flex-row items-center justify-center gap-2 rounded-lg px-4",
          size === "compact" ? "h-10" : "h-12",
          variants[variant],
          (disabled === true || loading) && "opacity-50",
          className,
        )}
      >
        {loading && <ActivityIndicator color={spinner} />}
        <Text variant="label">{label}</Text>
      </Pressable>
    </TextClassContext.Provider>
  );
}
