import { describe, expect, it } from "vitest";
import { requireValid } from "./validation.js";

describe("requireValid", () => {
  it("accepts valid input and preserves an invalid input explanation", () => {
    expect(() => {
      requireValid(true, "valid");
    }).not.toThrow();
    expect(() => {
      requireValid(false, "Invalid scoring input.");
    }).toThrow(new RangeError("Invalid scoring input."));
  });
});
