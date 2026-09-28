import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadModelRegistry } from "./registry";
function files(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "__pycache__"
        ? []
        : files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}
it("AC-1 keeps committed model identifiers only in the registry", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const ids = new Set(
    Object.values(loadModelRegistry().classes).flatMap((entry) =>
      Object.values(entry.candidates).map((candidate) => candidate.modelId),
    ),
  );
  const sources = [
    "services/api/src",
    "evaluation/src",
    "evaluation/python",
  ].flatMap((path) => files(join(root, path)));
  for (const path of sources.filter(
    (file) => !file.endsWith("model-registry.json"),
  )) {
    // Module paths identify source files, including the required streaming adapter filename.
    const text = readFileSync(path, "utf8").replace(
      /(?:from\s+|import\s*)["'][.][^"']+["']/g,
      "",
    );
    for (const id of ids)
      expect(text.includes(id), `${path} contains a registry identifier`).toBe(
        false,
      );
  }
});
