// Generates src/contract.gen.ts from contract/machine.schema.json.
// With --check it writes nothing and exits 1 if the committed file differs,
// which is what makes the build fail when the contract drifts.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Schema = {
  $ref?: string;
  enum?: string[];
  const?: string;
  type?: string;
  nullable?: boolean;
  oneOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
};

const root = new URL("../", import.meta.url);
const schemaPath = fileURLToPath(new URL("contract/machine.schema.json", root));
const outPath = fileURLToPath(new URL("src/contract.gen.ts", root));

export function tsType(s: Schema, indent = ""): string {
  const base = baseType(s, indent);
  return s.nullable ? `${base} | null` : base;
}

function baseType(s: Schema, indent: string): string {
  if (s.$ref) return s.$ref;
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.oneOf) return s.oneOf.map((o) => tsType(o, indent)).join("\n" + indent + "  | ");
  switch (s.type) {
    case "string": return "string";
    case "integer":
    case "number": return "number";
    case "boolean": return "boolean";
    case "array": {
      if (!s.items) throw new Error("array without items");
      const inner = tsType(s.items, indent);
      return /[ |]/.test(inner) ? `readonly (${inner})[]` : `readonly ${inner}[]`;
    }
    case "object": {
      const props = s.properties ?? {};
      const required = new Set(s.required ?? []);
      const lines = Object.entries(props).map(
        ([k, v]) => `${indent}  readonly ${k}${required.has(k) ? "" : "?"}: ${tsType(v, indent + "  ")};`,
      );
      return `{\n${lines.join("\n")}\n${indent}}`;
    }
    default:
      throw new Error(`unsupported schema: ${JSON.stringify(s)}`);
  }
}

export function generate(schema: { $defs: Record<string, Schema> }): string {
  const out = [
    "// GENERATED from contract/machine.schema.json by scripts/gen-contract.ts. Do not edit.",
    "// Run `npm run contract` after changing the schema; the build fails if this file is stale.",
    "",
  ];
  for (const [name, def] of Object.entries(schema.$defs)) {
    out.push(`export type ${name} =\n  ${tsType(def, "")};`, "");
  }
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const generated = generate(JSON.parse(readFileSync(schemaPath, "utf8")));
  if (process.argv.includes("--check")) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== generated) {
      console.error("contract drift: src/contract.gen.ts does not match contract/machine.schema.json. Run `npm run contract`.");
      process.exit(1);
    }
    console.log("contract ok");
  } else {
    writeFileSync(outPath, generated);
    console.log("wrote src/contract.gen.ts");
  }
}
