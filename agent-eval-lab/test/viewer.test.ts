import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createViewer } from "../viewer/server.ts";

const dir = mkdtempSync(join(tmpdir(), "runs-"));
writeFileSync(join(dir, "one.json"), JSON.stringify({ id: "x", model: "m", startedAt: "t", passed: 1, total: 2, cases: [] }));
writeFileSync(join(dir, "broken.json"), "{not json");
writeFileSync(join(dir, "notes.txt"), "ignore me");

const server = createViewer(dir);
await new Promise<void>((r) => server.listen(0, r));
after(() => server.close());
const url = (p: string) => `http://localhost:${(server.address() as AddressInfo).port}${p}`;

test("serves the page with a strict content security policy", async () => {
  const res = await fetch(url("/"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.match(await res.text(), /Agent Eval Lab/);
});

test("TypeScript files reach the browser with their types removed", async () => {
  for (const p of ["/app.ts", "/src/compare.ts"]) {
    const res = await fetch(url(p));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/);
    const code = await res.text();
    assert.doesNotMatch(code, /import type|interface |: RunRecord/, p);
  }
});

test("lists only readable .json runs", async () => {
  const body = (await (await fetch(url("/api/runs"))).json()) as { runs: { file: string }[] };
  assert.deepEqual(body.runs.map((r) => r.file), ["one.json"]);
});

test("a run file can be fetched, a missing one is a 404", async () => {
  assert.equal((await fetch(url("/api/runs/one.json"))).status, 200);
  assert.equal((await fetch(url("/api/runs/missing.json"))).status, 404);
});

test("file names that try to leave the runs folder are refused", async () => {
  for (const p of ["/api/runs/..%2Fpackage.json", "/api/runs/%2e%2e%2fpackage.json", "/api/runs/notes.txt", "/api/runs/a%2Fb.json"]) {
    assert.equal((await fetch(url(p))).status, 400, p);
  }
});

test("other paths and methods are refused", async () => {
  assert.equal((await fetch(url("/package.json"))).status, 404);
  assert.equal((await fetch(url("/src/world.ts"))).status, 404);
  assert.equal((await fetch(url("/"), { method: "POST" })).status, 405);
});
