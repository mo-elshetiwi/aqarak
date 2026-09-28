import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useSession } from "@/features/auth/session-provider";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { ScreenHeader } from "@/components/shell/screen-header";
/** Unsupported mobile capacities retain an honest explanation and local exit. */
export default function NoMobileRoleScreen(): ReactNode {
  const t = useTranslations("Mobile");
  const { signOut } = useSession();
  return (
    <SafeAreaView
      testID="no-mobile-role"
      className="flex-1 gap-6 bg-background p-4"
    >
      <LocaleSwitch />
      <ScreenHeader title={t("noMobileRole")} />
      <Text>{t("webRoles")}</Text>
      <Button
        testID="sign-out"
        label={t("signOut")}
        onPress={() => {
          void signOut();
        }}
      />
    </SafeAreaView>
  );
}
