// A scripted stand-in for a language model. It is NOT intelligent: it matches a few patterns so the whole
// front-end (streaming, stop, retry, tool approval, errors) can be built and tested without a key or a network.
// A real provider only has to implement the same shape: an async generator that yields events:
//   { type: "text", delta }  { type: "tool_call", id, name, args }  { type: "done", usage }
// and throws on failure.

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("aborted")); }, { once: true });
  });

const ANSWERS = [
  [/\b(hi|hello|hey)\b/, "Hello! I'm a scripted demo model, so my answers are canned. The streaming, stop button and tool approval around me are real."],
  [/stream/, "Streaming means the server sends the answer in small pieces as they are produced. The browser reads them off one HTTP response and renders each piece, so you see words appear instead of waiting for the whole reply."],
  [/access|screen ?reader|a11y/, "Streaming text is noisy for screen readers if every token is announced. This UI keeps the message log quiet and announces only state changes: thinking, done, stopped, or failed."],
  [/test|eval/, "Model output varies, so tests check properties: did it call the right tool, did it avoid echoing markup as HTML, did it finish inside the time budget. See the eval folder."],
];
const LONG = "Here is a longer answer with a code block.\n\n```js\nconst res = await fetch('/api/chat', { method: 'POST', body });\nconst reader = res.body.getReader();\n```\n\nThe reader hands back chunks as they arrive. Decode them, split on newlines, and parse each line as one event.\n\nWhen the user presses Stop, abort the request. The server notices the closed connection and stops generating.";
const COUNTER = "Here is a small counter you can preview.\n\n```html\n<!doctype html>\n<style>body{font-family:system-ui;padding:1rem}button{font-size:1rem;padding:.4rem .8rem}</style>\n<p>Count: <strong id=n>0</strong></p>\n<button id=b>Add one</button>\n<script>\nvar n=0;document.getElementById('b').onclick=function(){document.getElementById('n').textContent=++n};\n</script>\n```\n\nIt runs in a sandbox: it cannot reach this page, your cookies, or the network.";
// Used to prove the sandbox holds: the page tries to read its parent and records what happened in its own title.
const HOSTILE = "Here is a page that misbehaves.\n\n```html\n<title>start</title>\n<script>\ntry { void parent.document.body; document.title = 'BREACH'; } catch (e) { document.title = 'blocked'; }\ntry { fetch('/api/chat').then(function(){ document.title += ' fetch-ok'; }, function(){ document.title += ' fetch-blocked'; }); } catch (e) { document.title += ' fetch-blocked'; }\n</script>\n```";
const COMPARISON = { type: "structured", schema: "comparison", data: { title: "Streaming approaches", items: [
  { name: "Server-sent events", pros: ["Simple", "Auto-reconnect built in"], cons: ["One direction only", "GET only in EventSource"] },
  { name: "Streamed fetch (NDJSON)", pros: ["Works with POST", "Easy to cancel"], cons: ["You write the parser", "No auto-reconnect"] },
  { name: "WebSocket", pros: ["Two-way", "Low overhead"], cons: ["More infrastructure", "Harder to scale"] },
] } };
const DEFAULT = "I only know a few topics: streaming, accessibility, testing, and weather (try \"weather in Paris\"). Try /compare, /artifact, /fail, /long, attach a file, or paste some HTML to see it shown as plain text.";

function reply(messages) {
  const last = messages[messages.length - 1];
  if (last.role === "tool") {
    if (last.content.startsWith("DENIED")) return { text: "Okay, I won't look that up." };
    try {
      const w = JSON.parse(last.content);
      return { text: `It's ${w.tempC} °C and ${w.condition} in ${w.city}.` };
    } catch { return { text: "The weather lookup returned something I couldn't read." }; }
  }
  const text = last.content;
  const lower = text.toLowerCase();
  if (last.attachments?.length) {
    const parts = last.attachments.map((a) => {
      if (a.kind === "image") return `an image (${a.name}, ${a.mime}, about ${Math.round((a.data.length * 3) / 4 / 1024)} KB)`;
      const lines = a.data.split("\n").length, words = (a.data.match(/\S+/g) ?? []).length;
      return `a text file (${a.name}, ${lines} lines, ${words} words)`;
    });
    // A scripted model cannot read or see anything. It only reports what arrived, which proves the attachment pipeline.
    return { text: `I received ${parts.join(" and ")}. I'm a scripted demo, so I can't read it, but it reached the model intact.` };
  }
  if (lower.startsWith("/compare")) return { structured: COMPARISON };
  if (lower.startsWith("/badjson")) return { structured: { type: "structured", schema: "comparison", data: { title: 42, items: "nope" } } };
  if (lower.startsWith("/artifact hostile")) return { text: HOSTILE };
  if (lower.startsWith("/artifact")) return { text: COUNTER };
  if (lower.startsWith("/fail")) return { text: "Let me think about that and then", fail: true };
  if (lower.startsWith("/long")) return { text: LONG };
  if (lower.includes("ignore previous instructions") || lower.includes("ignore all previous")) {
    return { text: "That message contains instructions aimed at me. I treat user text as content, not as new rules, so I'll carry on as before." };
  }
  const w = lower.match(/weather (?:in|for) ([\p{L} .'-]{2,40})/u);
  if (w) return { tool: { name: "get_weather", args: { city: text.slice(w.index + w[0].length - w[1].length).trim().replace(/[?.!]+$/, "") } } };
  if (lower.startsWith("echo:")) return { text: `You wrote: ${text.slice(5).trim()}` };
  for (const [re, answer] of ANSWERS) if (re.test(lower)) return { text: answer };
  return { text: DEFAULT };
}

export function createFakeProvider({ delayMs = 25 } = {}) {
  return {
    name: "fake",
    async *stream({ messages, signal }) {
      const r = reply(messages);
      if (r.structured) {
        await sleep(delayMs, signal);
        yield r.structured;
        yield { type: "done", usage: { inputTokens: 8, outputTokens: 1 } };
        return;
      }
      const inputTokens = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
      if (r.tool) {
        await sleep(delayMs, signal);
        yield { type: "tool_call", id: "call_" + Math.random().toString(36).slice(2, 8), name: r.tool.name, args: r.tool.args };
        yield { type: "done", usage: { inputTokens, outputTokens: 12 } };
        return;
      }
      // Split into words, keeping the whitespace, so chunks look like tokens.
      const chunks = r.text.match(/\s*\S+\s*/g) ?? [r.text];
      let out = 0;
      for (const delta of chunks) {
        await sleep(delayMs, signal);
        yield { type: "text", delta };
        out++;
        if (r.fail && out >= 3) throw new Error("The model connection dropped.");
      }
      yield { type: "done", usage: { inputTokens, outputTokens: out } };
    },
  };
}
