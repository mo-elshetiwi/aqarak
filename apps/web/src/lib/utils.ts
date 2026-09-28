import { createCn } from "cn/config";
import type { CnFunction } from "cn";
import { typeScale } from "@aqarak/ui-tokens";

/** Keeps named type sizes independent of semantic text colours during merging. */
export const cn: CnFunction = createCn({
  extend: {
    classGroups: { "font-size": [{ text: Object.keys(typeScale.latin) }] },
  },
});
