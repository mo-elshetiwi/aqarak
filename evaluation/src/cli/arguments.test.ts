import { expect, it } from "vitest";
import { parseScreenArguments, SCREEN_HELP } from "./arguments";
const required = [
  "--class",
  "mc1_document_extraction",
  "--split",
  "screening",
  "--candidates",
  "fake-first,fake-second",
  "--run-id",
  "fixture",
  "--cap-usd",
  "0.000001",
];
it("parses exact integer micro-dollar caps and the package-manager separator", () => {
  expect(parseScreenArguments(["--", ...required])).toMatchObject({
    candidates: ["fake-first", "fake-second"],
    "cap-usd": 1,
    concurrency: 4,
    resume: false,
  });
  expect(
    parseScreenArguments([
      ...required,
      "--resume",
      "--limit",
      "2",
      "--concurrency",
      "1",
    ]),
  ).toMatchObject({ resume: true, limit: 2, concurrency: 1 });
});
it("shows help without requiring environment configuration", () => {
  expect(parseScreenArguments(["--help"])).toBeNull();
  expect(SCREEN_HELP).toContain("--cap-usd");
});
it.each([
  ["--concurrency", "0"],
  ["--limit", "-1"],
  ["--cap-usd", "0.0000001"],
  ["--run-id", "../escape"],
  ["--split", "unknown"],
  ["--candidates", "same,same"],
  ["--unknown", "sensitive-fixture"],
])("rejects invalid selection %s without printing its value", (...invalid) => {
  expect(() => parseScreenArguments([...required, ...invalid])).toThrow(
    "Invalid screening arguments",
  );
});

it("accepts the frozen held-out split", () => {
  expect(
    parseScreenArguments([...required, "--split", "held_out"]),
  ).toMatchObject({ split: "held_out" });
});
