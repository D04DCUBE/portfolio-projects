import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lintSource } from "../scripts/lint-tokens.ts";

const bad = (line: string) => lintSource("x.tsx", line).map((v) => v.rule);

test("the real source passes the token lint", () => {
  execFileSync("node", ["scripts/lint-tokens.ts"], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
});

test("raw colours are caught", () => {
  assert.equal(bad('<div className="bg-[#ff0000]" />').includes("no raw hex colours"), true);
  assert.equal(bad('<div style={{ color: "rgb(1,2,3)" }} />').includes("no rgb()/hsl() colours"), true);
});

test("arbitrary and pixel sizes are caught", () => {
  assert.ok(bad('<div className="h-[40px]" />').includes("no arbitrary pixel sizes"));
  assert.ok(bad('<div style={{ width: 20px }} />').length > 0);
});

test("sub-touch fixed sizes are caught, token sizes are not", () => {
  assert.ok(bad('<button className="h-8 w-8" />').length > 0);
  assert.ok(bad('<button className="min-h-10" />').length > 0);
  assert.deepEqual(bad('<button className="min-h-key min-w-touch h-full w-full h-dot w-40" />'), []);
});

test("tiny text is caught", () => {
  assert.ok(bad('<p className="text-sm" />').length > 0);
  assert.deepEqual(bad('<p className="text-body text-glance" />'), []);
});

test("a line can opt out explicitly, and reports its line number", () => {
  assert.deepEqual(bad('<i className="h-3" /> {/* token-lint-ok */}'), []);
  assert.equal(lintSource("a.tsx", "ok\n<b className=\"h-2\" />")[0]?.line, 2);
});
