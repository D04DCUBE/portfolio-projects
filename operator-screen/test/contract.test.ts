import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generate, tsType } from "../scripts/gen-contract.ts";

const schema = JSON.parse(readFileSync(new URL("../contract/machine.schema.json", import.meta.url), "utf8"));

test("the committed generated types match the schema", () => {
  const committed = readFileSync(new URL("../src/contract.gen.ts", import.meta.url), "utf8");
  assert.equal(committed, generate(schema));
});

test("the drift check exits 0 when in sync", () => {
  execFileSync("node", ["scripts/gen-contract.ts", "--check"], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
});

test("a changed schema produces different output, so drift would be caught", () => {
  const changed = structuredClone(schema);
  changed.$defs.Drawer.enum.push("jammed");
  assert.notEqual(generate(changed), generate(schema));
  assert.match(generate(changed), /"closed" \| "open" \| "jammed"/);
});

test("the generator handles each construct", () => {
  assert.equal(tsType({ type: "string" }), "string");
  assert.equal(tsType({ type: "integer", nullable: true }), "number | null");
  assert.equal(tsType({ $ref: "Foo" }), "Foo");
  assert.equal(tsType({ const: "x" }), '"x"');
  assert.equal(tsType({ type: "array", items: { type: "string" } }), "readonly string[]");
  assert.match(tsType({ type: "object", properties: { a: { type: "string" }, b: { type: "boolean" } }, required: ["a"] }), /readonly a: string;[\s\S]*readonly b\?: boolean;/);
  assert.throws(() => tsType({ type: "weird" }));
  assert.throws(() => tsType({ type: "array" }));
});
