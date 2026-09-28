import type { Messages } from "@aqarak/i18n";
import "use-intl";
declare module "use-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}
