import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function violations(source: string): string[] {
  const file = ts.createSourceFile(
    "component.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "className") {
      const initializer = node.initializer;
      const value =
        initializer && ts.isJsxExpression(initializer)
          ? initializer.expression
          : initializer;
      if (
        value &&
        (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      ) {
        const classes = value.text.split(/\s+/);
        const muted = classes.some((token) =>
          /(?:^|:)text-muted-foreground(?:\/[^\s]+)?$/.test(token),
        );
        const tinted = classes.some((token) =>
          /(?:^|:)bg-(?:muted|secondary|accent|ai-bg|(?:status|confidence)-[a-z-]+)(?:\/[^\s]+)?$/.test(
            token,
          ),
        );
        if (muted && tinted) found.push(value.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}

it.each([
  "bg-muted",
  "bg-secondary",
  "bg-accent",
  "bg-ai-bg",
  "bg-status-attention-bg",
  "bg-confidence-check-bg",
  "dark:bg-muted/50",
])(
  "rejects muted text paired with %s in a single className literal",
  (background) => {
    const classes = `text-muted-foreground ${background}`;
    expect(violations(`<p className="${classes}" />`)).toEqual([classes]);
    expect(violations(`<p className={'${classes}'} />`)).toEqual([classes]);
    expect(violations("<p className={`" + classes + "`} />")).toEqual([
      classes,
    ]);
  },
);
it("allows foreground text on tinted surfaces and muted text on a card", () => {
  expect(
    violations(
      '<><p className="text-foreground bg-muted" /><p className="text-muted-foreground bg-card" /></>',
    ),
  ).toEqual([]);
});
it("keeps muted text off tinted surfaces in component className literals", () => {
  const root = new URL("../components/", import.meta.url).pathname;
  const found = sources(root).flatMap((file) =>
    violations(readFileSync(file, "utf8")).map(
      (classes) => `${relative(root, file)}: ${classes}`,
    ),
  );
  expect(found).toEqual([]);
});
