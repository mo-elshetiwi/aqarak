import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { TabName } from "@/features/auth/role";
import { EmptyState } from "@/components/states/screen-states";
import { ScreenHeader } from "./screen-header";
/** Foundation routes describe upcoming content without fabricating records. */
export function TabScreen({ name }: { name: TabName }): ReactNode {
  const t = useTranslations("Mobile");
  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "left", "right"]}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        <ScreenHeader title={t(`tabs.${name}`)} />
        <EmptyState sentence={t(`content.${name}`)} />
      </ScrollView>
    </SafeAreaView>
  );
}
