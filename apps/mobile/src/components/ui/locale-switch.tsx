import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useLocale } from "@/features/locale/locale-provider";
import { Button } from "./button";
import { Text } from "./text";
/** Language preference failures remain visible without losing the current screen. */
export function LocaleSwitch(): ReactNode {
  const { locale, setLocale } = useLocale();
  const t = useTranslations("Mobile");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function change(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await setLocale(locale === "en" ? "ar" : "en");
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        testID="locale-switch"
        label={t("switchLanguage")}
        loading={pending}
        onPress={() => {
          void change();
        }}
      />
      {failed && (
        <Text accessibilityLiveRegion="polite">
          {t("errors.unexpected_response")}
        </Text>
      )}
    </>
  );
}
