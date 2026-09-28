import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactElement,
  type Ref,
} from "react";
import { Text as NativeText } from "react-native";
import { cn } from "@/lib/utils";
import {
  TextLocaleContext,
  textStyle,
  type TypeRole,
} from "@/theme/typography";
/** Composed controls share a semantic text colour. */
export const TextClassContext = createContext<string | undefined>(undefined);
/** Applies readable type roles and explicit reading-start alignment in both scripts. */
export function Text({
  variant = "bodyLg",
  className,
  style,
  ...props
}: ComponentProps<typeof NativeText> & {
  variant?: TypeRole;
  ref?: Ref<NativeText>;
}): ReactElement {
  const locale = useContext(TextLocaleContext);
  const inherited = useContext(TextClassContext);
  return (
    <NativeText
      accessibilityRole={
        variant.startsWith("h") || variant === "display" ? "header" : "text"
      }
      {...props}
      style={[textStyle(locale, variant), style]}
      className={cn("text-foreground", inherited, className)}
    />
  );
}
