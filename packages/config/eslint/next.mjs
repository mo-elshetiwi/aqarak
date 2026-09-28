import nextVitals from "eslint-config-next/core-web-vitals";
import { base } from "./base.mjs";
/** Web rules combine the framework's accessibility rules with shared checks. */
export const next = [...nextVitals, ...base];
