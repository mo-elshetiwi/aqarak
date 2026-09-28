import type { Locale } from "@aqarak/i18n";
import enAuth from "../../../packages/i18n/messages/en/Auth.json" with { type: "json" };
import enNavigation from "../../../packages/i18n/messages/en/Navigation.json" with { type: "json" };
import enShell from "../../../packages/i18n/messages/en/Shell.json" with { type: "json" };
import enStates from "../../../packages/i18n/messages/en/States.json" with { type: "json" };
import arAuth from "../../../packages/i18n/messages/ar/Auth.json" with { type: "json" };
import arNavigation from "../../../packages/i18n/messages/ar/Navigation.json" with { type: "json" };
import arShell from "../../../packages/i18n/messages/ar/Shell.json" with { type: "json" };
import arStates from "../../../packages/i18n/messages/ar/States.json" with { type: "json" };
const english = {
  Auth: enAuth,
  Navigation: enNavigation,
  Shell: enShell,
  States: enStates,
};
const arabic = {
  Auth: arAuth,
  Navigation: arNavigation,
  Shell: arShell,
  States: arStates,
};
/** I load the real catalogues through the test process's native JSON boundary. */
export function getMessages(locale: Locale): typeof english {
  return locale === "ar" ? arabic : english;
}
