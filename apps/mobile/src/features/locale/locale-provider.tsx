import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "use-intl";
import { LocaleProvider as RouterLocaleProvider } from "expo-router";
import { getMessages, getDirection, type Locale } from "@aqarak/i18n";
import { TextLocaleContext } from "@/theme/typography";
import { loadLocale, saveLocale } from "./preference";
interface LocaleValue {
  locale: Locale;
  direction: "ltr" | "rtl";
  setLocale: (locale: Locale) => Promise<void>;
}
const Context = createContext<LocaleValue | null>(null);
/** Shared messages use Western digits and Dubai time in both interfaces. */
export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}): ReactNode {
  const [locale, setValue] = useState<Locale | null>(initialLocale ?? null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (initialLocale) return;
    let mounted = true;
    void loadLocale()
      .then((value) => {
        if (mounted) setValue(value);
      })
      .catch(() => {
        if (mounted)
          setError(new Error("Locale preference could not be loaded"));
      });
    return () => {
      mounted = false;
    };
  }, [initialLocale]);
  if (error) throw error;
  if (!locale) return null;
  const direction = getDirection(locale);
  async function setLocale(next: Locale): Promise<void> {
    await saveLocale(next);
    setValue(next);
  }
  return (
    <Context.Provider value={{ locale, direction, setLocale }}>
      <IntlProvider
        locale={`${locale}-u-nu-latn`}
        messages={getMessages(locale)}
        timeZone="Asia/Dubai"
      >
        <TextLocaleContext.Provider value={locale}>
          <RouterLocaleProvider direction={direction}>
            {children}
          </RouterLocaleProvider>
        </TextLocaleContext.Provider>
      </IntlProvider>
    </Context.Provider>
  );
}
/** Consumers cannot silently use a different language from the navigator. */
export function useLocale(): LocaleValue {
  const value = useContext(Context);
  if (!value) throw new Error("LocaleProvider is required");
  return value;
}
