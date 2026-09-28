import type { ReactNode } from "react";
import { Stack } from "expo-router";
/** Authentication screens retain their own route namespace. */
export default function AuthLayout(): ReactNode {
  return <Stack screenOptions={{ headerShown: false }} />;
}
