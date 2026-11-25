// Design-token lint. Colours, sizes and spacing come from src/styles.css, never from the component code.
// Exits 1 on any violation. Exported so the tests can check each rule.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Violation = { readonly file: string; readonly line: number; readonly rule: string; readonly text: string };

const RULES: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: "no raw hex colours", re: /#[0-9a-fA-F]{3,8}\b/ },
  { rule: "no rgb()/hsl() colours", re: /\b(?:rgb|rgba|hsl|hsla)\(/ },
  { rule: "no arbitrary pixel sizes", re: /\[[^\]\s]*\d+(?:px|rem|em)\]/ },
  { rule: "no inline pixel sizes", re: /style=\{\{[^}]*\d+px/ },
  { rule: "no sub-touch fixed sizes (h-/w-/min-h-/min-w- 1..11)", re: /(?<![\w-])(?:min-)?[hw]-(?:[1-9]|1[01])(?![\w./-])/ },
  { rule: "no text-xs or text-sm: text must be readable at a glance", re: /(?<![\w-])text-(?:xs|sm)(?![\w-])/ },
];

// Small decorative marks (a dot or bar) may opt out with this exact comment on the same line.
const OPT_OUT = "token-lint-ok";

export function lintSource(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes(OPT_OUT)) return;
    for (const { rule, re } of RULES) if (re.test(line)) out.push({ file, line: i + 1, rule, text: line.trim() });
  });
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = walk(root).filter((f) => /\.(tsx|html)$/.test(f));
  const found = files.flatMap((f) => lintSource(f.slice(root.length), readFileSync(f, "utf8")));
  for (const v of found) console.error(`${v.file}:${v.line}  ${v.rule}\n    ${v.text}`);
  if (found.length) process.exit(1);
  console.log(`token lint ok (${files.length} files)`);
}
