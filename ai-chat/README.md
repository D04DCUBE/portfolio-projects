# AI Chat

A streaming chat UI and a small server, in plain Node and browser JavaScript with no dependencies. It runs with a **built-in fake model**, so it needs no API key and no network. The fake model is scripted and not intelligent; everything around it is the real thing.

```
cd projects/ai-chat
node server.js        # http://localhost:3100
npm test              # 19 tests: server, schemas, pipeline
npm run eval          # 26 eval cases against the stream
```

Try: `hello`, `how does streaming work`, `weather in Paris` (asks for approval), `/long` (code block), `/fail` (error and Retry), `/compare` (structured output as a card), `/badjson` (invalid structured output), `/artifact` (HTML with a sandboxed Preview), the Attach button, `echo: <img src=x onerror=alert(1)>` (shown as text), and Stop or Escape while an answer streams.

## What it shows

| Concern | How it is handled |
| --- | --- |
| Streaming | `POST /api/chat` answers with newline-delimited JSON, one event per line. The browser reads `response.body` and parses each complete line. |
| Request states | `idle`, `submitted`, `streaming`, `awaiting_approval`, `error`. One variable decides which buttons show. |
| Stop | `AbortController` on the client. The server sees the closed connection and aborts the provider, so no tokens are generated for nobody. |
| Failure | A mid-stream error sends a short safe message. Details stay in the server log. Retry asks again from the same history. |
| Re-render cost | Chunks can arrive faster than frames, so the bubble re-renders at most once per animation frame. |
| Safe rendering | Model output goes through `textContent`, never `innerHTML`. HTML in an answer is shown, not run. CSP blocks inline script as a second layer. |
| Tool use | The model asks for `get_weather`. The UI shows the call and waits for Approve or Deny. The server validates the model's arguments again, since they are untrusted. |
| Accessibility | The log is quiet while streaming (`aria-busy`). A separate live region announces state changes only: thinking, done, stopped, failed, approval needed. Focus moves to Approve. Enter sends, Shift+Enter adds a line, Escape stops. |
| Structured output | The model can send `{type:"structured", schema, data}`. `public/js/schemas.js` checks shape and size before anything is drawn. Invalid data gets a plain notice, never a half-built card. The same validator runs in the tests and evals. |
| Multimodal input | Attach up to three files: `.txt .md .csv .json` text or PNG, JPEG, WebP images. Checked in the browser for size and type, and again on the server. SVG is refused because it can carry script. Older turns keep a text note instead of the image data. |
| Artifact rendering | An `html` code block gets a Preview button. The HTML is stored briefly (newest 20) and served from `/artifact/<random id>` with `Content-Security-Policy: sandbox allow-scripts; default-src 'none'`, inside an iframe that also has `sandbox="allow-scripts"`. It runs, but it cannot reach the parent page, cookies or the server. A test page that tries exactly that is blocked. |
| Message pipeline | `public/js/pipeline.js`: outbound stages (`stripOldAttachments`, `limitHistory`) composed in order, each unit-tested. `stream.js` parses events, `render.js` builds DOM, `schemas.js` validates, `app.js` only orchestrates. |
| Measurement | Each answer shows time to first token, total time and chunk count. |
| Evals | `eval/cases.json` has 20 cases checked as properties (right tool, no leaked text, minimum chunks, time budget), because model output varies. |
| Adversarial cases | Prompt-injection text, HTML in input, a very long input, a tool argument that tries to smuggle text. |

## Adding a real model

Create `lib/providers/<name>.js` that exports a function returning `{ stream({ messages, signal }) }`, an async generator yielding `{type:"text",delta}`, `{type:"tool_call",id,name,args}` and finally `{type:"done",usage}`. Read the API key from `process.env` inside that file, register the name in `lib/providers/index.js`, and run with `PROVIDER=<name>`. Never put a key in the browser. The UI, tests and evals do not change.

## Limits

- The history lives in the page. Reloading clears it.
- Attachments are not persisted; images are only forwarded to the model for the turn they were attached.
- Markdown support is only code fences. A real product would add a sanitising renderer.
- The rate limiter is in memory and per process.
- The fake model cannot be wrong in interesting ways, so the evals here prove the harness works, not model quality.
