import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { temporaryDirectory } from "./test-fixtures";
import { containedPath, requirePrivateDirectory } from "./paths";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("rejects absolute paths and directory traversal in dataset metadata", () => {
  expect(containedPath("/synthetic", "pages/page.jpg")).toBe(
    "/synthetic/pages/page.jpg",
  );
  expect(() => containedPath("/synthetic", "../outside.jpg")).toThrow();
  expect(() => containedPath("/synthetic", "/outside.jpg")).toThrow();
});
it("resolves private directories and rejects symlinks into the repository", async () => {
  const root = await temporaryDirectory();
  roots.push(root);
  const repository = join(root, "repository");
  await mkdir(repository);
  await symlink(repository, join(root, "linked"));
  await expect(
    requirePrivateDirectory(join(root, "linked"), repository),
  ).rejects.toThrow("Private output resolves inside the repository");
  expect(
    await requirePrivateDirectory(join(root, "private"), repository),
  ).toMatch(/\/private$/);
});
