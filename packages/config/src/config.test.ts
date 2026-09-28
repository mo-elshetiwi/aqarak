import { describe, it, expect } from "vitest";
import { base } from "../eslint/base.mjs";
import { next } from "../eslint/next.mjs";
import { expo } from "../eslint/expo.mjs";
describe("shared configurations", () => {
  it.each([
    ["base", base],
    ["next", next],
    ["expo", expo],
  ])("loads %s as a non-empty array", (_name, config) => {
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(0);
  });
});
