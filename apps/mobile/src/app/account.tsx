import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslations } from "use-intl";
import { useSession } from "@/features/auth/session-provider";
import { useLocale } from "@/features/locale/locale-provider";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { authError } from "@/features/auth/auth-client";
import type { AuthErrorCode } from "@/features/auth/contract";
import { resolveMobileRole, roleHome } from "@/features/auth/role";
/** Person account controls remain available to every signed-in capacity. */
export default function AccountScreen(): ReactNode {
  const { state, signOut, switchContext } = useSession();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const { locale } = useLocale();
  const t = useTranslations("Mobile");
  if (state.status !== "signed_in") return null;
  const context = state.contexts.find(
    (item) => item.companyId === state.activeCompanyId,
  );
  async function chooseCompany(companyId: string): Promise<void> {
    if (switching || state.status !== "signed_in") return;
    setSwitching(true);
    setError(null);
    try {
      await switchContext(companyId);
      const chosen = state.contexts.find(
        (item) => item.companyId === companyId,
      );
      router.replace(roleHome(resolveMobileRole(chosen?.capacities ?? [])));
    } catch (failure) {
      setError(authError(failure).code);
    } finally {
      setSwitching(false);
    }
  }
  return (
    <SafeAreaView testID="account-screen" className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        <Button
          variant="ghost"
          label={t("back")}
          onPress={() => {
            router.back();
          }}
        />
        <Text variant="h1">{t("account")}</Text>
        <Text>{state.account.displayName}</Text>
        {context && (
          <View className="gap-2">
            <Text variant="label">{t("company")}</Text>
            <Text>{context.companyName[locale]}</Text>
            {context.isDemo && <Tag>{t("demo")}</Tag>}
            <Text variant="label">{t("capacity")}</Text>
            {context.capacities.map((capacity) => (
              <Text key={capacity}>{t(`roles.${capacity}`)}</Text>
            ))}
          </View>
        )}
        <View>
          <Text variant="label">{t("language")}</Text>
          <LocaleSwitch />
        </View>
        {state.contexts.length > 1 && (
          <View testID="company-switch" className="gap-2">
            <Text variant="label">{t("switchCompany")}</Text>
            {state.contexts.map((item) => (
              <Button
                key={item.companyId}
                variant="outline"
                label={item.companyName[locale]}
                accessibilityState={{
                  selected: item.companyId === state.activeCompanyId,
                }}
                disabled={switching || item.companyId === state.activeCompanyId}
                onPress={() => {
                  void chooseCompany(item.companyId);
                }}
              />
            ))}
            {error && (
              <Text
                accessibilityLiveRegion="polite"
                className="text-destructive"
              >
                {t(`errors.${error}`)}
              </Text>
            )}
          </View>
        )}
        {__DEV__ && (
          <Button
            testID="gallery-link"
            variant="secondary"
            label={t("Gallery.title")}
            onPress={() => {
              router.push("/gallery");
            }}
          />
        )}
        <Button
          testID="sign-out"
          label={t("signOut")}
          onPress={() => {
            void signOut();
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
