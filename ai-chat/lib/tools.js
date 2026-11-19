// Tools the model may ask for. The model's arguments are untrusted input, so each tool validates its own.
export class ToolError extends Error {}

const CITY = /^[\p{L} .'-]{2,40}$/u;

function fakeWeather(city) {
  // Deterministic fake data so tests and evals are repeatable. Swap for a real API call in a real product.
  let h = 0;
  for (const ch of city.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const conditions = ["sunny", "cloudy", "light rain", "windy", "foggy"];
  return { city, tempC: 8 + (h % 20), condition: conditions[h % conditions.length] };
}

export const TOOLS = {
  get_weather: {
    description: "Current weather for a city",
    // Tools with side effects or private data should always require approval. This one does too, to show the pattern.
    needsApproval: true,
    run(args) {
      if (!args || typeof args.city !== "string" || !CITY.test(args.city.trim())) {
        throw new ToolError("city must be 2-40 letters.");
      }
      return fakeWeather(args.city.trim());
    },
  },
};

export function runTool(name, args) {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) throw new ToolError("Unknown tool.");
  return tool.run(args);
}
