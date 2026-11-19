// Pick the model provider. PROVIDER=fake is the default and needs nothing.
// To add a real one, create lib/providers/<name>.js exporting createXProvider() with the same stream() shape,
// read its API key from process.env inside that file, and register it here. Never put a key in the browser.
import { createFakeProvider } from "./fake.js";

export function createProvider(name = process.env.PROVIDER || "fake", opts = {}) {
  if (name === "fake") return createFakeProvider(opts);
  throw new Error(`Unknown PROVIDER "${name}". Only "fake" is built in; see README to add one.`);
}
