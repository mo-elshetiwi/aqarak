import expoPreset from "eslint-config-expo/flat.js";
import { base } from "./base.mjs";
/** Mobile rules combine the framework's platform rules with shared checks. */
export const expo = [...expoPreset, ...base];
