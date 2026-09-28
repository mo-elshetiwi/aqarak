import type { ReactNode } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { useLocale } from "@/features/locale/locale-provider";
import { useSession } from "@/features/auth/session-provider";
import { resolveMobileRole } from "@/features/auth/role";
/** The active company and capacity stay visible above every work surface. */
export function ScreenHeader({ title }: { title: string }): ReactNode {
  const { state } = useSession();
  const { locale } = useLocale();
  const t = useTranslations("Mobile");
  const context =
    state.status === "signed_in"
      ? state.contexts.find((item) => item.companyId === state.activeCompanyId)
      : undefined;
  const role = resolveMobileRole(context?.capacities ?? []);
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="h1" className="flex-1">
          {title}
        </Text>
        <Button
          variant="ghost"
          testID="account-button"
          label={t("account")}
          onPress={() => {
            router.push("/account");
          }}
        />
      </View>
      {context && (
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="rounded-lg bg-secondary px-3 py-2">
            <Text variant="caption">
              {context.companyName[locale]}
              {role ? ` · ${t(`roles.${role}`)}` : ""}
            </Text>
          </View>
          {context.isDemo && <Tag>{t("demo")}</Tag>}
        </View>
      )}
    </View>
  );
}
