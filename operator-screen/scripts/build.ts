// Bundles the screen with esbuild and compiles Tailwind 4 with its own compiler API.
import { build } from "esbuild";
import { compile } from "tailwindcss";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const require = createRequire(import.meta.url);
mkdirSync(dist, { recursive: true });

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

await build({
  entryPoints: { app: join(root, "src/main.tsx"), sim: join(root, "src/sim.ts") },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// Tailwind: scan source files for candidate class names, then compile.
const sources = walk(join(root, "src")).filter((f) => /\.(tsx?|html)$/.test(f));
const candidates = new Set<string>();
for (const f of sources) for (const m of readFileSync(f, "utf8").matchAll(/[^\s"'`<>={}()]+/g)) candidates.add(m[0]);

const tailwindDir = dirname(require.resolve("tailwindcss/package.json"));
const compiler = await compile(readFileSync(join(root, "src/styles.css"), "utf8"), {
  base: join(root, "src"),
  async loadStylesheet(id, base) {
    const path = id === "tailwindcss" ? join(tailwindDir, "index.css")
      : id.startsWith("tailwindcss/") ? join(tailwindDir, id.slice("tailwindcss/".length))
      : resolve(base, id);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  },
  async loadModule() { throw new Error("plugins are not used"); },
});
writeFileSync(join(dist, "app.css"), compiler.build([...candidates]));

copyFileSync(join(root, "src/static/index.html"), join(dist, "index.html"));
copyFileSync(join(root, "src/static/sim.html"), join(dist, "sim.html"));
console.log("built dist/");
