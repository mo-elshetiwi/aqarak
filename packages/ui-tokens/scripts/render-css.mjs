import { URL } from "node:url";
import { writeFileSync } from "node:fs";
import { renderTokenCss } from "../src/index.ts";
writeFileSync(new URL("../tokens.css", import.meta.url), renderTokenCss());
