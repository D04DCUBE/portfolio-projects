# Portfolio projects

Eight small projects by [Parshuram Hadimani](https://parshuramhadimani.com), a front-end engineer. Each is a working app with automated tests, and most use plain JavaScript and Node with no dependencies (the training dashboard is TypeScript). Each has a short write-up on the [blog](https://parshuramhadimani.com/blog/) about what I learned and where it falls short.

These are personal learning projects, not products, and none has real users. I built them with AI assistance; the tests and browser checks are how I know they work. The AI chat and training dashboard use a fake model and simulated runs, so they need no keys and show no real data.

| Project | What it is | Tests |
| --- | --- | --- |
| [`browser-extension`](browser-extension) | Sign-in Safety Check, a Manifest V3 extension that flags risky login-page setups without reading what you type | manual test pages |
| [`design-system`](design-system) | Design tokens and four accessible Web Components with light and dark themes | contrast check script |
| [`kanban-app`](kanban-app) | A Kanban board with accounts, in plain Node: hashed passwords and sessions, CSRF defenses, per-user data checks | 15 |
| [`ai-chat`](ai-chat) | A streaming chat UI with Stop, retry, tool approval, validated structured output, attachments and a sandboxed HTML preview | 19 + 26 eval cases |
| [`realtime-chat`](realtime-chat) | Rooms, presence and typing over WebSockets with a hand-written protocol layer, reconnect and resume | 37 |
| [`notes-app`](notes-app) | Notes with BM25 search, highlighted snippets and answers that cite their source | 39 |
| [`training-dashboard`](training-dashboard) | Compare simulated training runs on live charts, with resume after a dropped connection. TypeScript | 29 |
| [`agent-eval-lab`](agent-eval-lab) | An MCP server, an agent loop, an eval suite, and a viewer that compares two runs. TypeScript | 32 |

## Run one

You need a recent Node (these use the built-in test runner and `fetch`). From a project folder:

```
node server.js     # the port is printed in the console
node --test        # run its tests
```

The browser extension is loaded from `chrome://extensions` (Developer mode, Load unpacked), and the design system is static files: see each README.

Blog posts: [extension](https://parshuramhadimani.com/blog/manifest-v3-extension-lessons/), [design system](https://parshuramhadimani.com/blog/design-tokens-web-components/), [Kanban](https://parshuramhadimani.com/blog/kanban-app-security-decisions/), [AI chat](https://parshuramhadimani.com/blog/ai-chat-ui-stop-retry-sandbox/), [real-time chat](https://parshuramhadimani.com/blog/websocket-chat-reconnect-and-resume/), [notes](https://parshuramhadimani.com/blog/notes-search-bm25-and-cited-answers/), [training dashboard](https://parshuramhadimani.com/blog/training-run-dashboard-live-charts-and-resume/).
