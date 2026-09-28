import type { ReactNode } from "react";
import { Text } from "./text";
/** Visible labels pair with native accessibility labels on each control. */
export function Label({ children }: { children: ReactNode }): ReactNode {
  return <Text variant="label">{children}</Text>;
}
