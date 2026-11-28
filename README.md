# Portfolio projects

[![CI](https://github.com/D04DCUBE/portfolio-projects/actions/workflows/ci.yml/badge.svg)](https://github.com/D04DCUBE/portfolio-projects/actions/workflows/ci.yml)

Nine small projects by [Parshuram Hadimani](https://parshuramhadimani.com), a front-end engineer. Each is a working app with automated tests, and most use plain JavaScript and Node with no runtime dependencies (the training dashboard and agent eval lab are TypeScript, and the operator screen uses React 19 and Tailwind). Each has a short write-up on the [blog](https://parshuramhadimani.com/blog/) about what I learned and where it falls short.

These are personal learning projects, not products, and none has real users. I built them with AI assistance; the tests and browser checks are how I know they work. The AI chat and training dashboard use a fake model and simulated runs, so they need no keys and show no real data.

| Project | What it is | Tests |
| --- | --- | --- |
| [`browser-extension`](browser-extension) | Sign-in Safety Check, a Manifest V3 extension that flags risky login-page setups without reading what you type | 5 Playwright (extension loaded in Chromium) |
| [`design-system`](design-system) | Design tokens and four accessible Web Components with light and dark themes | contrast check + 10 Playwright |
| [`kanban-app`](kanban-app) | A Kanban board with accounts, in plain Node: hashed passwords and sessions, CSRF defenses, per-user data checks | 15 + 18 Playwright |
| [`ai-chat`](ai-chat) | A streaming chat UI with Stop, retry, tool approval, validated structured output, attachments and a sandboxed HTML preview | 19 + 18 Playwright + 26 eval cases |
| [`realtime-chat`](realtime-chat) | Rooms, presence and typing over WebSockets with a hand-written protocol layer, reconnect and resume | 37 + 12 Playwright |
| [`notes-app`](notes-app) | Notes with BM25 search, highlighted snippets and answers that cite their source | 39 + 13 Playwright |
| [`training-dashboard`](training-dashboard) | Compare simulated training runs on live charts, with resume after a dropped connection. TypeScript | 29 + 15 Playwright |
| [`agent-eval-lab`](agent-eval-lab) | An MCP server, an agent loop, an eval suite, and a viewer that compares two runs. TypeScript | 32 + 10 Playwright |
| [`operator-screen`](operator-screen) | A touch-only screen for a simulated machine: React 19, Tailwind 4, WebSocket state owned by the machine, a generated contract, three-layer alerts | 47 + 23 Playwright |

## Run one

You need a recent Node (these use the built-in test runner and `fetch`). From a project folder:

```
node server.js     # the port is printed in the console
npm test           # unit tests (Node's built-in runner)
npm install        # once, for Playwright
npx playwright install chromium
npm run e2e        # Playwright: starts the app itself, then runs the API and UI tests
```

## How it is tested

Every project has two layers of automated tests, and [GitHub Actions](.github/workflows/ci.yml) runs both on every push and pull request.

- **Unit tests** use Node's built-in test runner and check the logic directly: validation, state machines, protocol framing, search scoring.
- **Playwright tests** run against the real app. Each project's config starts its server on a spare port with throwaway data, then runs two groups:
  - **API**: real HTTP and WebSocket calls with no browser: status codes, security headers, CSRF defences, rate limits, one user's data hidden from another, streaming formats, and malformed input.
  - **UI**: the main flows in Chromium, plus checks that user or model text is shown as text and never run as HTML.
- The design system has UI tests for its components (roles, labels, keyboard, focus, themes), and the browser extension is tested by loading it unpacked into Chromium and reading its badge and storage.

Writing these found and fixed real bugs: the operator screen's simulator page never loaded its script, its simulator accepted non-object JSON, and `<ds-button aria-label="…">` did not pass the label to the inner button, so screen readers heard only "Stop" for every Stop button in the training dashboard.

A failed CI run uploads the Playwright HTML report with traces.

The browser extension is loaded from `chrome://extensions` (Developer mode, Load unpacked), and the design system is static files: see each README.

Blog posts: [extension](https://parshuramhadimani.com/blog/manifest-v3-extension-lessons/), [design system](https://parshuramhadimani.com/blog/design-tokens-web-components/), [Kanban](https://parshuramhadimani.com/blog/kanban-app-security-decisions/), [AI chat](https://parshuramhadimani.com/blog/ai-chat-ui-stop-retry-sandbox/), [real-time chat](https://parshuramhadimani.com/blog/websocket-chat-reconnect-and-resume/), [notes](https://parshuramhadimani.com/blog/notes-search-bm25-and-cited-answers/), [training dashboard](https://parshuramhadimani.com/blog/training-run-dashboard-live-charts-and-resume/).
