import type { ReactNode } from "react";
import { Stack } from "expo-router";
/** Keeps role detail routes inside their guarded group. */
export default function RoleLayout(): ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}
