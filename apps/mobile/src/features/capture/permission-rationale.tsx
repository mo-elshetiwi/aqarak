import type { ReactNode } from "react";
import { Linking, View } from "react-native";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
/** Camera and voice capture share the same explicit permission continuation. */
export function PermissionRationale({
  rationale,
  denied,
  pending,
  onContinue,
  onSettingsFailure,
}: {
  rationale: string;
  denied: boolean;
  pending: boolean;
  onContinue: () => void;
  onSettingsFailure: () => void;
}): ReactNode {
  const t = useTranslations("Mobile.Capture");
  return (
    <View className="gap-4">
      <Text>{rationale}</Text>
      {denied ? (
        <>
          <Text accessibilityRole="alert">{t("errors.permission_denied")}</Text>
          <Button
            testID="permission-open-settings"
            label={t("openSettings")}
            onPress={() => {
              void Linking.openSettings().catch(onSettingsFailure);
            }}
          />
        </>
      ) : (
        <Button
          testID="permission-continue"
          label={t("continue")}
          loading={pending}
          onPress={onContinue}
        />
      )}
    </View>
  );
}
