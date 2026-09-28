import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";
import {
  renderContrastTable,
  renderPaletteTable,
} from "../src/contrast-contract.ts";

const destination = new URL(
  "../../../docs/design/brand-palette.md",
  import.meta.url,
);
let document = readFileSync(destination, "utf8");
for (const [name, table] of [
  ["contrast", renderContrastTable()],
  ["palette", renderPaletteTable()],
]) {
  document = document.replace(
    new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`),
    `<!-- ${name}:start -->\n\n${table}\n\n<!-- ${name}:end -->`,
  );
}
writeFileSync(destination, document);
