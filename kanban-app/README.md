# Kanban: a full-stack learning project

A Kanban board with accounts. You sign up, log in, and manage cards in three columns (To do, Doing, Done) by
drag and drop or by keyboard. Plain Node and JavaScript with **no dependencies**, and the UI is built from the
Web Components in `../design-system`. It is a personal learning project, not a production service.

## Run it
```
cd projects/kanban-app
node server.js          # then open http://localhost:3000
npm test                # 15 API tests (needs Node 18 or newer)
```
Data is saved in `data/db.json` (created on first run, ignored by git). Delete the file to start fresh.
Environment variables: `PORT` (default 3000), `DATA_FILE`, `COOKIE_SECURE=1` (set this behind HTTPS).

## What is in it
| Path | Job |
|---|---|
| `server.js` | HTTP server: JSON API, static files, security headers, error handling |
| `lib/store.js` | The only file that touches storage (a JSON file, written atomically) |
| `lib/auth.js` | Password hashing (scrypt), session tokens, cookies, rate limiter |
| `lib/validate.js` | Server-side input validation |
| `public/` | The front end: `app.js`, `styles.css`, and a copy of the design system in `ds/` |
| `test/api.test.js` | API tests using Node's built-in test runner |

## API
| Method and path | What it does |
|---|---|
| `POST /api/signup`, `/api/login`, `/api/logout` | Account and session. Login is rate limited |
| `GET /api/me` | Who am I (401 if signed out) |
| `GET /api/cards` | All my cards |
| `POST /api/cards` | Add a card: `{title, description?, column?}` |
| `PATCH /api/cards/:id` | Edit (`title`, `description`) and/or move (`column`, `index`) |
| `DELETE /api/cards/:id` | Delete |

Every card route returns the full, updated list for the signed-in user, so the client always shows what the server holds.

## Security decisions (and the reasons)
| Decision | Why |
|---|---|
| Passwords hashed with **scrypt**, random salt per user | A memory-hard hash makes stolen databases costly to crack. Identical passwords give different hashes |
| Constant-time comparison, plus a dummy hash when the email is unknown | Prevents timing differences that reveal which emails exist |
| Same error for wrong password and unknown email | Does not confirm which accounts exist (sign-up still says "already exists", a known trade-off) |
| Sessions: random 32-byte token, **only its SHA-256 hash is stored** | A leaked database does not leak usable session tokens |
| Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` behind HTTPS | JavaScript cannot read it, and other sites cannot make the browser send it |
| CSRF: required `X-Requested-With` header and JSON content type, on top of SameSite | A plain HTML form cannot send either, so cross-site form posts fail |
| Ownership checked in the storage layer; other users' ids return **404, not 403** | One user can never read or change another's data, and ids are not revealed |
| Login and sign-up **rate limits** | Slows password guessing and sign-up spam |
| Validation on the server, request body capped at 10 KB | The client is untrusted. Large bodies are refused |
| Static files: path traversal blocked | A request like `/../server.js` cannot read source files |
| `textContent` only in the front end, plus a strict **Content-Security-Policy** | Card text like `<img onerror=...>` is shown as text. Scripts only load from this origin |
| Errors: details logged, generic message sent | Does not leak internals |

## Things to be able to explain
- **Why no framework?** To see every layer. The routing, auth and storage are small enough to read in one sitting, and
  everything here maps directly onto Express, Fastify or ASP.NET.
- **Why is storage in its own module?** So moving from a JSON file to SQLite or Postgres means rewriting one file, and
  the rest is untouched (the repository pattern).
- **Why write to a temp file then rename?** Rename is atomic. A crash mid-write cannot leave a half-written database.
- **Why return the whole card list after each change?** Simple and always correct. The cost is more data per request.
  The alternative is returning only the changed card and merging it, which is faster but easier to get wrong.
- **How does drag and drop stay accessible?** Drag and drop is mouse-only, so every card also has "Move left" and
  "Move right" buttons with unique names ("Move right for Write README"), keyboard focus stays on the moved card, and a
  live region announces "Moved Write README to Doing".
- **Why does the CSP allow inline styles?** Web Components put `<style>` inside their shadow roots, which counts as inline.
  Scripts stay locked to this origin, which is the protection that matters most. A stricter option is constructable stylesheets.

## Honest limits
- The store is one JSON file read into memory: fine for a demo, not for many users or several server processes.
- The rate limiter lives in memory, so it resets on restart and is not shared between processes.
- No email verification, password reset, or password-strength meter. No account deletion.
- It needs HTTPS before real use. `COOKIE_SECURE=1` sets the `Secure` flag, but the server itself does not do TLS.
- Tested: 15 API tests (included) and a browser run through the whole flow (sign up, add, edit, move by keyboard and by drag, delete,
  persistence after reload, a second user sees nothing, XSS text stays text, wrong password, logout and log in). The
  browser script is not included because it needs Playwright. Not tested: VoiceOver, Firefox, Safari, slow networks.

## Exercises (one per day)
1. Replace `lib/store.js` with SQLite (`node:sqlite` in Node 22) and keep every test passing. That is the payoff of the store boundary.
2. Add a React or Next.js front end that talks to the same API. Compare it with `public/app.js`.
3. Add board columns you can rename, and several boards per user.
4. Reorder cards with the keyboard (arrow keys while a card is focused) and announce the new position.
5. Add a Playwright test that drives the browser flow, and run it in CI.
6. Add optimistic updates: move the card in the UI first and roll back if the server refuses.
7. Deploy it (a small VPS or a container host) behind HTTPS and set `COOKIE_SECURE=1`.
