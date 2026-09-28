import type { ColorValue } from "react-native";
import type { ReactNode } from "react";
import { Tabs } from "expo-router";
import {
  Home,
  Inbox,
  Folder,
  Wrench,
  Sparkles,
  Building2,
  Receipt,
  Wallet,
} from "lucide-react-native";
import { useTranslations } from "use-intl";
import { roleTabs, type MobileRole, type TabName } from "@/features/auth/role";
import { useThemeColors } from "@/theme/colors";
import { textStyle } from "@/theme/typography";
import { useLocale } from "@/features/locale/locale-provider";
const icons = {
  home: Home,
  inbox: Inbox,
  records: Folder,
  maintenance: Wrench,
  "co-worker": Sparkles,
  portfolio: Building2,
  statements: Receipt,
  payments: Wallet,
  jobs: Wrench,
};
/** Outline icons keep the selected state tied to the brand colour. */
export function TabBarIcon({
  name,
  color,
}: {
  name: TabName;
  color: ColorValue;
}): ReactNode {
  const Icon = icons[name];
  return <Icon size={24} color={color} strokeWidth={2} accessible={false} />;
}
/** Layouts use the exact role-specific tab order and always-visible labels. */
export function RoleTabs({ role }: { role: MobileRole }): ReactNode {
  const t = useTranslations("Mobile.tabs");
  const colors = useThemeColors();
  const { locale } = useLocale();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarItemStyle: { minHeight: 48 },
        tabBarLabelStyle: textStyle(locale, "caption"),
      }}
    >
      {roleTabs[role].map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(name),
            tabBarAccessibilityLabel: t(name),
            tabBarButtonTestID: `tab-${name}`,
            tabBarIcon: ({ color }) => <TabBarIcon name={name} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
