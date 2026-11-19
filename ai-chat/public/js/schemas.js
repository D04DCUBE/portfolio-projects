// Validators for structured model output. Pure functions with no DOM, so the browser, tests and evals share them.
// Never trust the model's JSON: check shape and size before rendering anything.
const str = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const strList = (v, maxItems, maxLen) => Array.isArray(v) && v.length <= maxItems && v.every((x) => str(x, maxLen));

export function validateComparison(data) {
  if (!data || typeof data !== "object") return { ok: false, error: "not an object" };
  if (!str(data.title, 80)) return { ok: false, error: "title must be 1-80 characters" };
  if (!Array.isArray(data.items) || data.items.length < 2 || data.items.length > 6) return { ok: false, error: "items must be 2-6 entries" };
  for (const [i, item] of data.items.entries()) {
    if (!item || !str(item.name, 60) || !strList(item.pros, 6, 120) || !strList(item.cons, 6, 120)) return { ok: false, error: `item ${i} is malformed` };
  }
  return { ok: true };
}

export const SCHEMAS = { comparison: validateComparison };

export function validateStructured(event) {
  const check = Object.hasOwn(SCHEMAS, event?.schema) ? SCHEMAS[event.schema] : null;
  return check ? check(event.data) : { ok: false, error: "unknown schema" };
}
