import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath, mkdir } from "node:fs/promises";
import { z } from "zod";
export const safeIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const itemIdSchema = z.union([
  safeIdSchema,
  z.string().regex(/^(?:ar_eg|en_us)\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
]);
/** Resolve a relative dataset path without allowing traversal. */
export function containedPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const difference = relative(resolve(root), absolute);
  if (
    isAbsolute(path) ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  )
    throw new Error("Dataset path leaves its root");
  return absolute;
}
/** Refuse private output folders that resolve inside the repository. */
export async function requirePrivateDirectory(
  directory: string,
  repositoryRoot: string,
): Promise<string> {
  const lexical = relative(resolve(repositoryRoot), resolve(directory));
  if (
    lexical === "" ||
    (!lexical.startsWith(`..${sep}`) &&
      lexical !== ".." &&
      !isAbsolute(lexical))
  )
    throw new Error("Private output must be outside the repository");
  await mkdir(directory, { recursive: true });
  const actual = await realpath(directory);
  const root = await realpath(repositoryRoot);
  const difference = relative(root, actual);
  if (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  )
    throw new Error("Private output resolves inside the repository");
  return actual;
}
