import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";
const config: NextConfig = {
  agentRules: false,
  headers: async () => Promise.resolve(securityHeaders()),
  transpilePackages: ["@aqarak/domain", "@aqarak/i18n", "@aqarak/ui-tokens"],
};
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(config);
